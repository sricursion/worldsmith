import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import type { GradeKind } from '../world/spec';
import {
  QUALITY_TIERS,
  createPostPipeline,
  initialQualityFor,
  initialQualityState,
  publishQuality,
  stepQuality,
  type Quality,
} from './post';

export interface Viewport {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  resize(): void;
  start(step: (dt: number) => void): void;
  stop(): void;
  dispose(): void;
  /** Sets the tier now and makes it the ceiling of automatic stepping (which may still step down). */
  setQuality?(q: 0 | 1 | 2): void;
  getQuality?(): 0 | 1 | 2;
  /** Colour grade of the final pass; strength 0..1 blends it against the ungraded picture. */
  setGrade?(grade: GradeKind, strength?: number): void;
  /**
   * Objects in this scene draw after the fog and before the bloom, with no depth buffer: their shaders
   * test against AIR_UNIFORMS.tDepth (see engine/post). Weather lives here.
   */
  overlay?: Scene;
}

const MAX_DT = 0.1;

function gpuName(renderer: WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = info !== null ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

/** Returns null (and sets data-webgl="unavailable" on the canvas) when a WebGL context cannot be created. */
export function createViewport(canvas: HTMLCanvasElement): Viewport | null {
  let renderer: WebGLRenderer;
  try {
    // The scene is drawn into a multisampled float target, so the canvas itself needs neither depth nor antialiasing.
    renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    canvas.dataset['webgl'] = 'unavailable';
    return null;
  }
  canvas.dataset['webgl'] = 'ok';

  renderer.outputColorSpace = SRGBColorSpace;
  // The final pass tone-maps; three skips its own curve when drawing into a render target. The setting
  // stays so anything drawn straight to the canvas would still match.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5; // the sky rig takes over per hour
  renderer.setClearColor(0x2c4f8a); // a blue frame, not black, if the sky has not drawn yet
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  camera.position.set(0, 4, 10);

  if (canvas.style.width === '') canvas.style.width = '100%';
  if (canvas.style.height === '') canvas.style.height = '100%';
  canvas.style.display = 'block';

  const post = createPostPipeline(renderer, scene, camera);
  const tierState = initialQualityState(initialQualityFor(gpuName(renderer)));
  let quality: Quality = tierState.level;
  post.setQuality(quality);
  publishQuality(quality);
  canvas.dataset['quality'] = String(quality);

  // The canvas is fixed to the viewport by CSS, so its own box is the size source. The parent (body)
  // has no height of its own and would report a 1 px strip.
  const sizeSource = canvas;

  const resize = (): void => {
    const w = Math.max(1, Math.floor(sizeSource.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(sizeSource.clientHeight || window.innerHeight));
    const ratio = Math.min(window.devicePixelRatio || 1, QUALITY_TIERS[quality].pixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, ratio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const applyQuality = (q: Quality): void => {
    if (q === quality) return;
    quality = q;
    post.setQuality(q);
    resize();
    publishQuality(q);
    canvas.dataset['quality'] = String(q);
  };

  const observer = new ResizeObserver(() => resize());
  observer.observe(sizeSource);
  window.addEventListener('resize', resize);
  resize();

  let stepFn: ((dt: number) => void) | null = null;
  let running = false;
  let raf = 0;
  let last = 0;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const elapsed = now - last;
    const dt = Math.min(MAX_DT, Math.max(0, elapsed / 1000));
    last = now;
    if (stepFn !== null) stepFn(dt);
    post.render(dt);
    applyQuality(stepQuality(tierState, elapsed).level);
  };

  const begin = (): void => {
    if (raf !== 0) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const halt = (): void => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onVisibility = (): void => {
    if (document.hidden) halt();
    else if (running) begin();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    canvas.dataset['webgl'] = 'lost';
  };
  const onContextRestored = (): void => {
    canvas.dataset['webgl'] = 'ok';
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  let disposed = false;

  return {
    renderer,
    scene,
    camera,
    overlay: post.overlay,
    resize,
    start(step) {
      stepFn = step;
      running = true;
      if (!document.hidden) begin();
    },
    stop() {
      running = false;
      halt();
    },
    setQuality(q) {
      if (disposed) return;
      tierState.ceiling = q;
      tierState.level = q;
      tierState.frames = 0;
      tierState.accMs = 0;
      tierState.goodMs = 0;
      applyQuality(q);
    },
    getQuality() {
      return quality;
    },
    setGrade(grade, strength) {
      if (disposed) return;
      post.setGrade(grade, strength);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      halt();
      stepFn = null;
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      post.dispose();
      renderer.dispose();
    },
  };
}
