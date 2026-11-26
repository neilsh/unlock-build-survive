/**
 * WebGL renderer creation that survives flaky phones.
 *
 * Some Android browsers refuse a WebGL context for certain attribute combinations (or when the GPU process is
 * busy) even though a plainer request works. We try a list of progressively safer option sets, each on a fresh
 * canvas, and only give up (throwing `WebGLUnavailableError`) when every one fails.
 */
import * as THREE from 'three';
import { WebGLUnavailableError } from '../utils/webglUnavailable';

export { WebGLUnavailableError };

export type RendererOptions = Pick<
  THREE.WebGLRendererParameters,
  'antialias' | 'powerPreference' | 'alpha' | 'stencil' | 'depth' | 'precision'
>;

/** Most to least demanding. The first entry is what a capable device gets. */
export function rendererAttempts(touch: boolean): RendererOptions[] {
  return [
    { antialias: !touch },
    { antialias: false },
    { antialias: false, alpha: false, stencil: false, precision: 'mediump' },
  ];
}

export interface RendererHandle<R, C> {
  renderer: R;
  canvas: C;
  /** Index of the attempt that worked (0 = first choice). */
  attempt: number;
}

/** Generic core, kept free of three/DOM so it can be unit tested in Node. */
export function createWithFallback<R, C>(
  attempts: readonly RendererOptions[],
  makeCanvas: () => C,
  makeRenderer: (canvas: C, options: RendererOptions) => R,
  discardCanvas: (canvas: C) => void = () => {},
): RendererHandle<R, C> {
  const reasons: string[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const canvas = makeCanvas();
    try {
      return { renderer: makeRenderer(canvas, attempts[i] ?? {}), canvas, attempt: i };
    } catch (err) {
      discardCanvas(canvas);
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new WebGLUnavailableError(reasons);
}

/** Creates the game's canvas + renderer, appending the canvas to `container`. */
export function createGameRenderer(
  container: HTMLElement,
  touch: boolean,
): RendererHandle<THREE.WebGLRenderer, HTMLCanvasElement> {
  const handle = createWithFallback(
    rendererAttempts(touch),
    () => {
      const canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.touchAction = 'none';
      container.appendChild(canvas);
      return canvas;
    },
    (canvas, options) => new THREE.WebGLRenderer({ canvas, ...options }),
    (canvas) => canvas.remove(),
  );
  return handle;
}
