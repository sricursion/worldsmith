import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Mesh, Scene, ShaderLib, Vector3 } from 'three';
import type { InstancedBufferGeometry, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three';
import type { MoodSpec, StyleSpec, SurfaceKind } from '../../app/src/world/spec';
import { makeRng } from '../../app/src/world/rng';
import { createLife, lifeLight, MOTE_CAP, nightFactor, planLife, sunHeight } from '../../app/src/engine/life';
import type { Life } from '../../app/src/engine/life';

const BOUNDS = { minX: -80, maxX: 80, minZ: -60, maxZ: 60 };

const mood = (weather: MoodSpec['weather'], ambience: string[] = [], intensity = 0.6): MoodSpec => ({ weather, intensity, grade: 'neutral', haze: 0.3, ambience, music: '' });
const style = (name: string, ground?: SurfaceKind): StyleSpec => ({
  name, wall: '#886655', wall2: '#775544', roof: '#443322', trim: '#ddccaa', accent: '#aa3322', dark: '#221100', glass: '#223344', glow: '#ffcc66',
  ground: '#665544', road: '#554433', variety: 0.3,
  surfaces: ground === undefined ? undefined : { wall: 'timber', wall2: 'planks', roof: 'shingle', trim: 'timber', ground, road: 'dirt', wear: 0.5, wet: 0 },
});

const instancesOf = (o: Object3D): number => (o instanceof InstancedMesh ? o.count : ((o as Mesh).geometry as InstancedBufferGeometry).instanceCount);
const uniformsOf = (scene: Scene, name: string): ShaderMaterial['uniforms'] => ((scene.getObjectByName(name) as Mesh).material as ShaderMaterial).uniforms;

/** Everything a frame could leak: nodes, instances, vertex data, uniform slots. */
function census(scene: Scene): string {
  const rows: string[] = [];
  let nodes = 0;
  scene.traverse((o: Object3D) => {
    nodes++;
    if (!(o instanceof Mesh)) return;
    const geo = o.geometry as InstancedBufferGeometry;
    const attrs = Object.keys(geo.attributes).map((k) => `${k}:${geo.getAttribute(k).array.length}`).join(',');
    const uniforms = Object.keys((o.material as Partial<ShaderMaterial>).uniforms ?? {}).length;
    rows.push(`${o.name}|${instancesOf(o)}|${attrs}|${uniforms}`);
  });
  return `${nodes}\n${rows.join('\n')}`;
}

describe('clock helpers', () => {
  it('puts the sun on the horizon at six and overhead at noon', () => {
    expect(sunHeight(6)).toBeCloseTo(0, 6);
    expect(sunHeight(12)).toBeCloseTo(1, 6);
    expect(sunHeight(0)).toBeCloseTo(-1, 6);
    expect(sunHeight(36)).toBeCloseTo(1, 6);
  });

  it('fades night in around dusk and stays within 0..1', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(18)).toBeCloseTo(0.5, 6);
    let prev = nightFactor(16);
    for (let h = 16; h <= 20; h += 0.1) {
      const n = nightFactor(h);
      expect(n).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      prev = n;
    }
  });

  it('lights sprites warm at golden hour, cool at night, bright at noon', () => {
    const noon = lifeLight(12, new Color());
    const dusk = lifeLight(17.3, new Color());
    const night = lifeLight(1, new Color());
    expect(noon.r).toBeGreaterThan(0.9);
    expect(noon.b).toBeGreaterThan(0.8);
    expect(dusk.r / dusk.b).toBeGreaterThan(noon.r / noon.b + 0.3);
    expect(night.b).toBeGreaterThan(night.r);
    expect(night.r + night.g + night.b).toBeLessThan(0.6);
  });
});

describe('planLife', () => {
  it('reads the world from theme, words, ground and weather', () => {
    expect(planLife('western', mood('dust'), style('weathered frontier timber', 'sand'))).toMatchObject({ flyer: 'birds', nightFlyer: 'bats', drift: 'tumbleweed', flag: 'flag', lights: 'lantern', insects: false });
    expect(planLife('medieval', mood('clear', ['gulls', 'waves']), style('salt-bleached harbour town', 'cobble'))).toMatchObject({ flyer: 'gulls', drift: 'leaves', flag: 'banner' });
    expect(planLife('scifi', mood('rain'), style('neon arcology', 'asphalt'))).toMatchObject({ flyer: 'drones', nightFlyer: 'drones', drift: 'none', flag: 'holo', lights: 'craft', insects: false });
    expect(planLife('medieval', mood('spores', ['crickets']), style('mushroom forest', 'moss'))).toMatchObject({ insects: true, drift: 'leaves' });
    expect(planLife('medieval', mood('snow'), style('snowbound monastery', 'snow'))).toMatchObject({ nightFlyer: 'none', drift: 'none', insects: false });
    expect(planLife('modern')).toMatchObject({ flyer: 'birds', drift: 'paper', lights: 'traffic' });
  });

  it('blows harder in a storm than in mist and thins the flock', () => {
    const storm = planLife('western', mood('storm', [], 1));
    const mist = planLife('western', mood('mist', [], 1));
    expect(storm.wind).toBeGreaterThan(mist.wind * 4);
    expect(storm.flockShare).toBeLessThan(planLife('western').flockShare);
  });
});

describe('createLife', () => {
  const build = (seed: number): { scene: Scene; life: Life } => {
    const scene = new Scene();
    const life = createLife(scene, {
      theme: 'western',
      mood: mood('dust'),
      style: style('weathered frontier timber', 'sand'),
      bounds: BOUNDS,
      smoke: [new Vector3(4, 6, 2), new Vector3(-10, 0.3, 8)],
      rng: makeRng(seed, 'life'),
    });
    return { scene, life };
  };

  it('adds only instanced, shader-animated parts', () => {
    const { scene, life } = build(7);
    const names = scene.children.map((c) => c.name).sort();
    expect(names).toEqual(['life_bats', 'life_birds', 'life_far_lights', 'life_flags', 'life_smoke', 'life_tumbleweed']);
    for (const c of scene.children) {
      expect(c.frustumCulled).toBe(false);
      expect(instancesOf(c)).toBeGreaterThan(1);
    }
    life.dispose();
  });

  it('keeps object, instance and buffer counts constant across 100 updates', () => {
    const { scene, life } = build(11);
    const focus = new Vector3(3, 0, -2);
    life.update(1 / 60, focus, 9);
    const before = census(scene);
    const children = scene.children.slice();
    const buffers = children.map((c) => Object.values((c as Mesh).geometry.attributes).map((a) => a.array));
    const uniformValues = children.map((c) => Object.values((c as Mesh<InstancedBufferGeometry, ShaderMaterial>).material.uniforms ?? {}).map((u) => u.value as unknown));
    for (let i = 0; i < 100; i++) {
      focus.x += 0.05;
      life.update(1 / 60, focus, 9 + i * 0.15);
    }
    expect(census(scene)).toBe(before);
    expect(scene.children).toEqual(children);
    scene.children.forEach((c, i) => {
      const now = Object.values((c as Mesh).geometry.attributes).map((a) => a.array);
      now.forEach((arr, j) => expect(arr).toBe(buffers[i]?.[j]));
      // Vector and colour uniforms are written in place: the same objects, never fresh ones.
      const values = Object.values((c as Mesh<InstancedBufferGeometry, ShaderMaterial>).material.uniforms ?? {}).map((u) => u.value as unknown);
      values.forEach((v, j) => {
        if (typeof v === 'object' && v !== null) expect(v).toBe(uniformValues[i]?.[j]);
      });
    });
    life.dispose();
  });

  it('advances time, follows the focus and swaps day flyers for night ones', () => {
    const { scene, life } = build(3);
    const birds = uniformsOf(scene, 'life_birds');
    const bats = uniformsOf(scene, 'life_bats');
    life.update(0.5, new Vector3(5, 0, 6), 12);
    expect(birds.uTime?.value).toBeCloseTo(0.1, 6); // long frames are clamped
    expect((birds.uFocus?.value as Vector3).x).toBe(5);
    expect(birds.uVis?.value).toBe(1);
    expect(bats.uVis?.value).toBe(0);
    life.update(0.016, new Vector3(5, 0, 6), 23);
    expect(birds.uVis?.value).toBe(0);
    expect(bats.uVis?.value).toBe(1);
    life.dispose();
  });

  it('is deterministic for a seed and removes everything on dispose', () => {
    const a = build(21);
    const b = build(21);
    const c = build(22);
    const data = (s: Scene): number[] => Array.from((s.getObjectByName('life_birds') as Mesh).geometry.getAttribute('aFly').array);
    expect(data(a.scene)).toEqual(data(b.scene));
    expect(data(a.scene)).not.toEqual(data(c.scene));
    for (const x of [a, b, c]) {
      x.life.dispose();
      x.life.dispose();
      expect(x.scene.children).toHaveLength(0);
      x.life.update(0.016, new Vector3(), 12); // harmless after dispose
    }
  });

  it('binds every uniform and attribute its shaders declare, with balanced source', () => {
    const scenes = [build(2).scene, new Scene(), new Scene()];
    createLife(scenes[1] as Scene, { theme: 'scifi', mood: mood('clear'), style: style('neon arcology'), bounds: BOUNDS, smoke: [new Vector3()], rng: makeRng(1, 'life') });
    createLife(scenes[2] as Scene, { theme: 'medieval', mood: mood('fireflies', ['crickets']), style: style('mushroom forest', 'moss'), bounds: BOUNDS, rng: makeRng(1, 'life') });
    const declared = (src: string, kind: 'uniform' | 'attribute'): string[] =>
      [...src.matchAll(new RegExp(`^\\s*${kind}\\s+\\w+\\s+([^;]+);`, 'gm'))].flatMap((m) => (m[1] ?? '').split(',').map((s) => s.trim()));
    let checked = 0;
    for (const scene of scenes) {
      for (const c of scene.children) {
        const mesh = c as Mesh<InstancedBufferGeometry, ShaderMaterial>;
        if (mesh.material.type !== 'ShaderMaterial') continue;
        checked++;
        for (const src of [mesh.material.vertexShader, mesh.material.fragmentShader]) {
          for (const [open, close] of [['(', ')'], ['{', '}'], ['[', ']']] as const) {
            expect(src.split(open).length, `${c.name} ${open}${close}`).toBe(src.split(close).length);
          }
          for (const u of declared(src, 'uniform')) expect(mesh.material.uniforms[u], `${c.name} uniform ${u}`).toBeDefined();
          expect(src).toContain('void main()');
        }
        for (const a of declared(mesh.material.vertexShader, 'attribute')) expect(mesh.geometry.getAttribute(a), `${c.name} attribute ${a}`).toBeDefined();
        // Per-instance data must cover every instance.
        for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
          if ('isInstancedBufferAttribute' in attr) expect(attr.count, `${c.name} ${name}`).toBe(mesh.geometry.instanceCount);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
    expect(scenes[1]?.getObjectByName('life_drones')).toBeDefined();
    expect(scenes[1]?.getObjectByName('life_paper')).toBeDefined();
    expect(scenes[2]?.getObjectByName('life_insects')).toBeDefined();
    expect(scenes[2]?.getObjectByName('life_leaves')).toBeDefined();
  });

  it('patches the waving cloth into the stock standard shader at anchors that exist', () => {
    for (const theme of ['western', 'medieval', 'scifi'] as const) {
      const scene = new Scene();
      const life = createLife(scene, { theme, bounds: BOUNDS, rng: makeRng(4, 'life') });
      const flags = scene.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
      expect(flags.count).toBeGreaterThanOrEqual(4);
      expect(flags.instanceColor).not.toBeNull();
      expect(flags.geometry.getAttribute('aFly').count).toBe(flags.geometry.getAttribute('position').count);
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
      (flags.material as MeshStandardMaterial).onBeforeCompile(shader as never, null as never);
      expect(shader.vertexShader).toContain('attribute vec2 aFly;');
      expect(shader.vertexShader).toContain('objectNormal = normalize(');
      expect(shader.vertexShader).toContain('transformed.z += tfDisp;');
      expect(shader.vertexShader.indexOf('float tfDisp')).toBeLessThan(shader.vertexShader.indexOf('transformed.z += tfDisp;'));
      expect(shader.fragmentShader).toContain('diffuseColor.rgb = uPole;');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance += diffuseColor.rgb * uGlow');
      for (const u of ['uTime', 'uWave', 'uRun', 'uPole', 'uTrim', 'uGlow']) expect(shader.uniforms[u], u).toBeDefined();
      // Cloth is free at the fly end and pinned at the hoist; poles do not move at all.
      const fly = flags.geometry.getAttribute('aFly');
      let pinned = 0;
      let free = 0;
      for (let i = 0; i < fly.count; i++) {
        if (fly.getY(i) < 0.5) expect(fly.getX(i)).toBe(0);
        else if (fly.getX(i) === 0) pinned++;
        else if (fly.getX(i) > 0.99) free++;
      }
      expect(pinned).toBeGreaterThan(0);
      expect(free).toBeGreaterThan(0);
      life.dispose();
    }
  });

  it('fills still air with motes that suit the place and leaves it to the weather otherwise', () => {
    expect(planLife('medieval', mood('clear'), style('mushroom forest', 'moss')).motes).toBe('pollen');
    expect(planLife('western', mood('clear'), style('weathered frontier timber', 'sand')).motes).toBe('dust');
    expect(planLife('medieval', mood('clear'), style('basalt forge above a lava field')).motes).toBe('embers');
    expect(planLife('medieval', mood('clear'), style('snowbound monastery', 'snow')).motes).toBe('none');
    for (const w of ['rain', 'storm', 'snow', 'dust', 'ash', 'spores', 'embers', 'fireflies'] as const) expect(planLife('medieval', mood(w), style('mushroom forest', 'moss')).motes, w).toBe('none');
    expect(planLife('scifi', mood('clear'), style('underwater coral city'))).toMatchObject({ flyer: 'fish', nightFlyer: 'none', motes: 'bubbles', drift: 'none', insects: false });
  });

  it('caps the motes, scales them with quality and schools fish for a sunken world', () => {
    const counts = ([0, 1, 2] as const).map((quality) => {
      const scene = new Scene();
      const life = createLife(scene, { theme: 'medieval', mood: mood('clear'), style: style('underwater coral city'), bounds: BOUNDS, quality, rng: makeRng(8, 'life') });
      const n = instancesOf(scene.getObjectByName('life_motes') as Object3D);
      expect(scene.getObjectByName('life_fish')).toBeDefined();
      expect(scene.getObjectByName('life_bats')).toBeUndefined();
      expect(uniformsOf(scene, 'life_fish').uMode?.value).toBe(2);
      life.dispose();
      return n;
    });
    expect(counts[2]).toBe(MOTE_CAP);
    expect(counts[0]).toBeLessThan(counts[1] as number);
    expect(counts[1]).toBeLessThan(counts[2] as number);
    // Motes come last: a world's birds are where they were before there were motes at all.
    const birds = (m: MoodSpec): number[] => {
      const scene = new Scene();
      createLife(scene, { theme: 'western', mood: m, style: style('weathered frontier timber', 'sand'), bounds: BOUNDS, rng: makeRng(21, 'life') });
      return Array.from((scene.getObjectByName('life_birds') as Mesh).geometry.getAttribute('aFly').array);
    };
    expect(birds(mood('clear'))).toEqual(birds(mood('fog')));
  });

  it('skips smoke without sources and honours given flag anchors and quality', () => {
    const scene = new Scene();
    const low = createLife(scene, { theme: 'medieval', bounds: BOUNDS, flags: [new Vector3(1, 0, 1), new Vector3(9, 4, 2)], quality: 0, rng: makeRng(5, 'life') });
    expect(scene.getObjectByName('life_smoke')).toBeUndefined();
    expect(instancesOf(scene.getObjectByName('life_banners') as Object3D)).toBe(2);
    const scene2 = new Scene();
    const high = createLife(scene2, { theme: 'medieval', bounds: BOUNDS, quality: 2, rng: makeRng(5, 'life') });
    expect(instancesOf(scene2.getObjectByName('life_birds') as Object3D)).toBeGreaterThan(instancesOf(scene.getObjectByName('life_birds') as Object3D));
    low.dispose();
    high.dispose();
  });
});
