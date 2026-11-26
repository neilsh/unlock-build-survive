/**
 * `?gpu=noshadow,pr1,...` lets us try graphics combinations on a real phone by editing the address.
 * `?gpu=safe` turns them all on. (WebGL 1 is not offered: this three.js version only supports WebGL 2.)
 */
export interface GpuFlags {
  /** No shadow maps. */
  noshadow: boolean;
  /** No multisample anti-aliasing. */
  nomsaa: boolean;
  /** Render at pixel ratio 1. */
  pr1: boolean;
  /** No tone mapping. */
  notone: boolean;
  /** Draw at most about 30 frames per second. */
  fps30: boolean;
}

export const NO_GPU_FLAGS: GpuFlags = {
  noshadow: false,
  nomsaa: false,
  pr1: false,
  notone: false,
  fps30: false,
};

export function parseGpuFlags(search: string): GpuFlags {
  const names = new Set(
    (new URLSearchParams(search).get('gpu') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const all = names.has('safe');
  return {
    noshadow: all || names.has('noshadow'),
    nomsaa: all || names.has('nomsaa'),
    pr1: all || names.has('pr1'),
    notone: all || names.has('notone'),
    fps30: all || names.has('fps30'),
  };
}

export function describeGpuFlags(f: GpuFlags): string {
  const on = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length > 0 ? on.join(',') : 'none';
}

/** Imagination PowerVR GPUs (Pixel 10) have been seen losing the context a few seconds after start. */
export function isPowerVr(gpu: string | null): boolean {
  return gpu !== null && /powervr|imagination/i.test(gpu);
}
