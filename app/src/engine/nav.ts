// Navigation: a recast solo navmesh built from the town's static meshes, plus a Crowd for NPC agents.
//
// recast-navigation ships the wasm inline (@recast-navigation/wasm), so init() works unchanged in the
// browser and under Node/vitest; no Node-specific import is needed. init() runs once per page (module-level
// promise) and every buildNav call awaits it.
import * as THREE from 'three';
import { init, Crowd, NavMesh, NavMeshQuery, setRandomSeed } from 'recast-navigation';
import type { CrowdAgent } from 'recast-navigation';
import { NavMeshHelper, getPositionsAndIndices, threeToSoloNavMesh } from '@recast-navigation/three';
import { makeRng } from '../world/rng';

export interface NavAgent {
  position(): THREE.Vector3;
  velocity(): THREE.Vector3;
  setTarget(p: THREE.Vector3): void;
  stop(): void;
  remove(): void;
}

export interface NavWorld {
  addAgent(pos: THREE.Vector3, opts?: { radius?: number; speed?: number }): NavAgent;
  moveAlongSurface(from: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3;
  randomPointNear(p: THREE.Vector3, r: number): THREE.Vector3;
  nearest(p: THREE.Vector3): THREE.Vector3;
  update(dt: number): void;
  debugMesh(): THREE.Object3D;
  dispose(): void;
}

const MAX_STEP = 1 / 30;
const MAX_SUBSTEPS = 8;
const MAX_AGENTS = 64;
const AGENT_HEIGHT = 1.8;
const CLIMB = 0.5;
const CELL_HEIGHT = 0.2;

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  initPromise ??= init();
  return initPromise;
}

export async function buildNav(
  statics: THREE.Mesh[],
  ground: THREE.Mesh,
  opts: { cellSize?: number; agentRadius?: number } = {},
): Promise<NavWorld> {
  await ensureInit();
  const cellSize = opts.cellSize ?? 0.3;
  const agentRadius = opts.agentRadius ?? 0.4;

  // Recast config is in voxel units for radius, height and climb.
  const result = threeToSoloNavMesh([ground, ...statics], {
    cs: cellSize,
    ch: CELL_HEIGHT,
    walkableRadius: Math.ceil(agentRadius / cellSize),
    walkableHeight: Math.ceil(AGENT_HEIGHT / CELL_HEIGHT),
    walkableClimb: Math.ceil(CLIMB / CELL_HEIGHT),
    walkableSlopeAngle: 45,
  });
  if (!result.success) {
    throw new Error(`navmesh generation failed: ${result.error}`);
  }
  return new RecastNavWorld(result.navMesh, agentRadius);
}

class RecastNavWorld implements NavWorld {
  private readonly query: NavMeshQuery;
  private readonly crowd: Crowd;
  private readonly agents = new Set<CrowdAgent>();
  private helper: NavMeshHelper | null = null;
  private disposed = false;

  constructor(
    private readonly navMesh: NavMesh,
    private readonly agentRadius: number,
  ) {
    this.query = new NavMeshQuery(navMesh);
    this.query.defaultQueryHalfExtents = { x: 1.5, y: 1.5, z: 1.5 };
    this.crowd = new Crowd(navMesh, { maxAgents: MAX_AGENTS, maxAgentRadius: Math.max(agentRadius, 0.6) });
    setRandomSeed(makeRng(1, 'nav').int(1, 0x7fffffff));
  }

  addAgent(pos: THREE.Vector3, opts: { radius?: number; speed?: number } = {}): NavAgent {
    const start = this.nearest(pos);
    const speed = opts.speed ?? 1.6;
    const agent = this.crowd.addAgent(start, {
      radius: opts.radius ?? this.agentRadius,
      height: AGENT_HEIGHT,
      maxSpeed: speed,
      maxAcceleration: speed * 4,
      collisionQueryRange: 2,
      pathOptimizationRange: 8,
      separationWeight: 2,
    });
    this.agents.add(agent);
    const owner = this;
    return {
      position: () => new THREE.Vector3(agent.position().x, agent.position().y, agent.position().z),
      velocity: () => new THREE.Vector3(agent.velocity().x, agent.velocity().y, agent.velocity().z),
      setTarget: (p) => {
        const t = owner.nearest(p);
        agent.requestMoveTarget({ x: t.x, y: t.y, z: t.z });
      },
      stop: () => agent.resetMoveTarget(),
      remove: () => {
        if (owner.agents.delete(agent)) owner.crowd.removeAgent(agent);
      },
    };
  }

  moveAlongSurface(from: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3 {
    const start = this.query.findClosestPoint(from);
    if (!start.success || start.polyRef === 0) return from.clone();
    const end = { x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z };
    const res = this.query.moveAlongSurface(start.polyRef, from, end);
    if (!res.success) return new THREE.Vector3(start.point.x, start.point.y, start.point.z);
    const p = res.resultPosition;
    const lastRef = res.visited[res.visited.length - 1] ?? start.polyRef;
    const h = this.query.getPolyHeight(lastRef, p);
    return new THREE.Vector3(p.x, h.success ? h.height : p.y, p.z);
  }

  randomPointNear(p: THREE.Vector3, r: number): THREE.Vector3 {
    // Detour picks a random point in any polygon touching the circle, so on large polygons the point can lie
    // outside the radius. Resample a few times, then pull the last sample onto the circle.
    let last: THREE.Vector3 | null = null;
    for (let i = 0; i < 8; i++) {
      const res = this.query.findRandomPointAroundCircle(p, r);
      if (!res.success) break;
      const q = new THREE.Vector3(res.randomPoint.x, res.randomPoint.y, res.randomPoint.z);
      if (Math.hypot(q.x - p.x, q.z - p.z) <= r) return q;
      last = q;
    }
    if (!last) return this.nearest(p);
    const d = Math.hypot(last.x - p.x, last.z - p.z) || 1;
    const k = r / d;
    return this.nearest(new THREE.Vector3(p.x + (last.x - p.x) * k, last.y, p.z + (last.z - p.z) * k));
  }

  nearest(p: THREE.Vector3): THREE.Vector3 {
    const res = this.query.findClosestPoint(p);
    if (!res.success) return p.clone();
    return new THREE.Vector3(res.point.x, res.point.y, res.point.z);
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    const n = Math.min(MAX_SUBSTEPS, Math.ceil(dt / MAX_STEP));
    const step = Math.min(dt, MAX_SUBSTEPS * MAX_STEP) / n;
    for (let i = 0; i < n; i++) this.crowd.update(step);
  }

  debugMesh(): THREE.Object3D {
    this.helper ??= new NavMeshHelper(this.navMesh, {
      navMeshMaterial: new THREE.MeshBasicMaterial({ color: 0xff9a2e, wireframe: true, transparent: true, opacity: 0.6 }),
    });
    return this.helper;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of [...this.agents]) this.crowd.removeAgent(a);
    this.agents.clear();
    if (this.helper) {
      this.helper.navMeshGeometry.dispose();
      this.helper.navMeshMaterial.dispose();
      this.helper.removeFromParent();
      this.helper = null;
    }
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}

/** World-space merged triangle soup of the given meshes, for BVH raycasts. Null when there is no geometry. */
export function mergeWorldGeometry(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  if (meshes.length === 0) return null;
  const [positions, indices] = getPositionsAndIndices(meshes);
  if (positions.length === 0 || indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}
