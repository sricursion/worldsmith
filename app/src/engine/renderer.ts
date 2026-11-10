import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export interface Viewport {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  resize(): void;
  start(step: (dt: number) => void): void;
  stop(): void;
  dispose(): void;
}

const MAX_DT = 0.1;
const MAX_PIXEL_RATIO = 2;

/** Returns null (and sets data-webgl="unavailable" on the canvas) when a WebGL context cannot be created. */
export function createViewport(canvas: HTMLCanvasElement): Viewport | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    canvas.dataset['webgl'] = 'unavailable';
    return null;
  }
  canvas.dataset['webgl'] = 'ok';

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5; // the sky rig takes over per hour
  renderer.setClearColor(0x2c4f8a); // a blue frame, not black, if the sky has not drawn yet
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  camera.position.set(0, 4, 10);

  if (canvas.style.width === '') canvas.style.width = '100%';
  if (canvas.style.height === '') canvas.style.height = '100%';
  canvas.style.display = 'block';

  // The canvas is fixed to the viewport by CSS, so its own box is the size source. The parent (body)
  // has no height of its own and would report a 1 px strip.
  const sizeSource = canvas;

  const resize = (): void => {
    const w = Math.max(1, Math.floor(sizeSource.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(sizeSource.clientHeight || window.innerHeight));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;
    if (stepFn !== null) stepFn(dt);
    renderer.render(scene, camera);
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
      renderer.dispose();
    },
  };
}
