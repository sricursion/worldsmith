export interface Input {
  down(code: string): boolean;
  axis(): { x: number; y: number };
  onKey(code: string, cb: () => void): () => void;
  /** Accumulated orbit drag in pixels since the last call. */
  pointerDelta(): { dx: number; dy: number };
  /** Accumulated wheel zoom since the last call; positive scrolls away from the user (zoom out). */
  wheelDelta(): number;
  dispose(): void;
}

const AXIS_KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
} as const;

const JOYSTICK_RADIUS_PX = 56;
const DEAD_ZONE = 0.12;

/** Maps a joystick drag (pixels from the touch origin) to an axis pair in -1..1, +y = forward. */
export function joystickAxis(dx: number, dy: number, radius = JOYSTICK_RADIUS_PX): { x: number; y: number } {
  let x = dx / radius;
  let y = -dy / radius;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  if (len < DEAD_ZONE) return { x: 0, y: 0 };
  return { x, y };
}

/** Combines pressed keys into a unit-clamped movement axis, +y = forward, +x = right. */
export function keyAxis(isDown: (code: string) => boolean): { x: number; y: number } {
  const any = (codes: readonly string[]): number => (codes.some(isDown) ? 1 : 0);
  return {
    x: any(AXIS_KEYS.right) - any(AXIS_KEYS.left),
    y: any(AXIS_KEYS.forward) - any(AXIS_KEYS.back),
  };
}

function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function isInteractiveTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button';
}

interface TouchState {
  id: number;
  mode: 'joystick' | 'orbit';
  ox: number;
  oy: number;
  lx: number;
  ly: number;
}

export function createInput(target: HTMLElement): Input {
  const keys = new Set<string>();
  const handlers = new Map<string, Set<() => void>>();
  let dragDx = 0;
  let dragDy = 0;
  let wheel = 0;
  let mouseId: number | null = null;
  let mouseLx = 0;
  let mouseLy = 0;
  const touches = new Map<number, TouchState>();
  let joy = { x: 0, y: 0 };

  const typing = (): boolean => isTypingTarget(document.activeElement);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing()) return;
    const onControl = isInteractiveTarget(document.activeElement);
    if ((e.code.startsWith('Arrow') || e.code === 'Space') && !onControl) e.preventDefault();
    if (e.repeat) return;
    // A focused button keeps Space and the arrows for itself; the game does not also act on them.
    if (onControl && (e.code.startsWith('Arrow') || e.code === 'Space')) return;
    keys.add(e.code);
    const set = handlers.get(e.code);
    if (set !== undefined) for (const cb of [...set]) cb();
  };
  // Key releases are always honoured so a key held while focus moves into a text field cannot stick.
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const rect = target.getBoundingClientRect();
      const left = e.clientX - rect.left < rect.width / 2;
      const hasJoystick = [...touches.values()].some((t) => t.mode === 'joystick');
      const mode: TouchState['mode'] = left && !hasJoystick ? 'joystick' : 'orbit';
      touches.set(e.pointerId, { id: e.pointerId, mode, ox: e.clientX, oy: e.clientY, lx: e.clientX, ly: e.clientY });
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // capture can fail for synthetic pointers; window listeners still receive the moves
      }
      return;
    }
    if (e.button !== 0) return;
    if (typing() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    mouseId = e.pointerId;
    mouseLx = e.clientX;
    mouseLy = e.clientY;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // see above
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    const t = touches.get(e.pointerId);
    if (t !== undefined) {
      if (t.mode === 'joystick') {
        joy = joystickAxis(e.clientX - t.ox, e.clientY - t.oy);
      } else {
        dragDx += e.clientX - t.lx;
        dragDy += e.clientY - t.ly;
      }
      t.lx = e.clientX;
      t.ly = e.clientY;
      return;
    }
    if (mouseId === e.pointerId) {
      dragDx += e.clientX - mouseLx;
      dragDy += e.clientY - mouseLy;
      mouseLx = e.clientX;
      mouseLy = e.clientY;
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    const t = touches.get(e.pointerId);
    if (t !== undefined) {
      if (t.mode === 'joystick') joy = { x: 0, y: 0 };
      touches.delete(e.pointerId);
    }
    if (mouseId === e.pointerId) mouseId = null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    wheel += (e.deltaY * unit) / 100;
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  const prevTouchAction = target.style.touchAction;
  target.style.touchAction = 'none';

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('contextmenu', onContextMenu);

  let disposed = false;

  return {
    down: (code) => keys.has(code),
    axis() {
      const k = keyAxis((c) => keys.has(c));
      let x = k.x + joy.x;
      let y = k.y + joy.y;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      return { x, y };
    },
    onKey(code, cb) {
      let set = handlers.get(code);
      if (set === undefined) {
        set = new Set();
        handlers.set(code, set);
      }
      set.add(cb);
      return () => {
        handlers.get(code)?.delete(cb);
      };
    },
    pointerDelta() {
      const out = { dx: dragDx, dy: dragDy };
      dragDx = 0;
      dragDy = 0;
      return out;
    },
    wheelDelta() {
      const w = wheel;
      wheel = 0;
      return w;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
      target.style.touchAction = prevTouchAction;
      keys.clear();
      handlers.clear();
      touches.clear();
    },
  };
}
