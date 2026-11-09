// Boot: viewport, input, UI, API, game loop.

import { createViewport } from './engine/renderer';
import { createInput } from './engine/input';
import { createUI } from './ui/ui';
import { createApi } from './net/api';
import { Game } from './game';

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const root = document.getElementById('ui');
  if (!canvas || !root) throw new Error('missing #scene or #ui');

  const ui = createUI(root);
  const viewport = createViewport(canvas);
  if (!viewport) {
    ui.showError('This browser could not start WebGL. Try Chrome, Edge, Firefox or Safari with hardware acceleration on.');
    return;
  }
  const input = createInput(canvas);
  const api = createApi('/api');
  const game = new Game({ viewport, input, ui, api });

  viewport.start((dt) => game.update(dt));
  void game.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('boot failed:', message);
    ui.showError('Something broke while starting. Reload to try again.', () => {
      history.replaceState(null, '', location.pathname + location.search);
      location.reload();
    });
  });

  // Debug hook for scripted checks; harmless in production.
  (window as unknown as { __townforge?: unknown }).__townforge = { game, viewport, api };
}

boot();
