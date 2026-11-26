/**
 * WebGL renderer creation that survives flaky phones.
 *
 * Some Android browsers refuse a WebGL context for certain attribute combinations (or when the GPU process is
 * busy) even though a plainer request works. We try a list of progressively safer option sets, each on a fresh
 * canvas, and only give up (throwing `WebGLUnavailableError`) when every one fails.
 */
import * as THREE from 'three';
import { graphicsReport } from '../utils/graphicsReport';
import { WebGLUnavailableError } from '../utils/webglUnavailable';

export { WebGLUnavailableError };

export type RendererOptions = Pick<
  THREE.WebGLRendererParameters,
  'antialias' | 'powerPreference' | 'alpha' | 'stencil' | 'depth' | 'precision'
>;

/** Most to least demanding. The first entry is what a capable device gets. */
export function rendererAttempts(touch: boolean, safe = false): RendererOptions[] {
  if (safe)
    return [{ antialias: false, alpha: false, stencil: false, precision: 'mediump' }, { antialias: false }];
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

const liveRenderers = new Set<THREE.WebGLRenderer>();

/** Frees a renderer's GL context right away (the browser only allows a handful per page). */
export function releaseRenderer(renderer: THREE.WebGLRenderer): void {
  if (!liveRenderers.delete(renderer)) return;
  renderer.dispose();
  renderer.forceContextLoss();
}

/** Releases every context we still hold, e.g. after a start-up failure that left a half-built game. */
export function releaseAllRenderers(): void {
  // Deleting the current entry while iterating a Set is safe.
  for (const r of liveRenderers) releaseRenderer(r);
}

function recordGlInfo(renderer: THREE.WebGLRenderer): void {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    graphicsReport.gpu = String(gpu);
    graphicsReport.glVersion = String(gl.getParameter(gl.VERSION));
    graphicsReport.maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  } catch {
    // Diagnostics only.
  }
}

/** Creates the game's canvas + renderer, appending the canvas to `container`. */
export function createGameRenderer(
  container: HTMLElement,
  touch: boolean,
  safe = false,
): RendererHandle<THREE.WebGLRenderer, HTMLCanvasElement> {
  try {
    const handle = createWithFallback(
      rendererAttempts(touch, safe),
      () => {
        graphicsReport.attempts++;
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.touchAction = 'none';
        container.appendChild(canvas);
        return canvas;
      },
      (canvas, options) => new THREE.WebGLRenderer({ canvas, ...options }),
      (canvas) => {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      },
    );
    liveRenderers.add(handle.renderer);
    graphicsReport.contextsCreated++;
    recordGlInfo(handle.renderer);
    return handle;
  } catch (err) {
    if (err instanceof WebGLUnavailableError) graphicsReport.failures = err.reasons;
    throw err;
  }
}
