import { describe, expect, it } from 'vitest';
import { createWithFallback, rendererAttempts, WebGLUnavailableError } from './createRenderer';

describe('rendererAttempts', () => {
  it('skips MSAA first on touch devices and never asks for the high-performance GPU', () => {
    expect(rendererAttempts(true)[0]).toEqual({ antialias: false });
    expect(rendererAttempts(false)[0]).toEqual({ antialias: true });
    for (const a of rendererAttempts(false)) expect(a.powerPreference).toBeUndefined();
  });

  it('ends with the plainest request', () => {
    const last = rendererAttempts(false).at(-1)!;
    expect(last.antialias).toBe(false);
    expect(last.stencil).toBe(false);
  });
});

describe('createWithFallback', () => {
  const attempts = rendererAttempts(true);

  it('uses the first attempt when it works', () => {
    const h = createWithFallback(
      attempts,
      () => ({ id: 1 }),
      () => 'gl',
    );
    expect(h.attempt).toBe(0);
    expect(h.renderer).toBe('gl');
  });

  it('retries on a fresh canvas and discards the failed one', () => {
    let canvases = 0;
    const discarded: number[] = [];
    const h = createWithFallback(
      attempts,
      () => ({ id: ++canvases }),
      (c, _opts) => {
        if (c.id < 3) throw new Error(`no context #${c.id}`);
        return 'gl';
      },
      (c) => discarded.push(c.id),
    );
    expect(h.attempt).toBe(2);
    expect(h.canvas.id).toBe(3);
    expect(discarded).toEqual([1, 2]);
  });

  it('throws WebGLUnavailableError listing every reason when all attempts fail', () => {
    const failing = () =>
      createWithFallback(
        attempts,
        () => ({}),
        () => {
          throw new Error('Error creating WebGL context.');
        },
      );
    expect(failing).toThrow(WebGLUnavailableError);
    const err: unknown = (() => {
      try {
        failing();
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(WebGLUnavailableError);
    expect((err as WebGLUnavailableError).reasons).toHaveLength(attempts.length);
    expect((err as WebGLUnavailableError).message).toContain('Error creating WebGL context.');
  });
});
