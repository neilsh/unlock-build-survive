import { describe, expect, it } from 'vitest';
import { describeGpuFlags, isPowerVr, NO_GPU_FLAGS, parseGpuFlags } from './gpuFlags';

describe('parseGpuFlags', () => {
  it('is all off by default', () => {
    expect(parseGpuFlags('')).toEqual(NO_GPU_FLAGS);
    expect(parseGpuFlags('?debug')).toEqual(NO_GPU_FLAGS);
  });

  it('reads a comma list, ignoring case and unknown names', () => {
    const f = parseGpuFlags('?gpu=NoShadow, pr1,bogus');
    expect(f).toEqual({ ...NO_GPU_FLAGS, noshadow: true, pr1: true });
    expect(describeGpuFlags(f)).toBe('noshadow,pr1');
  });

  it('safe turns everything on', () => {
    expect(Object.values(parseGpuFlags('?gpu=safe')).every(Boolean)).toBe(true);
  });
});

describe('isPowerVr', () => {
  it('matches the Pixel 10 GPU string only', () => {
    expect(isPowerVr('ANGLE (Imagination Technologies, PowerVR D-Series DXT-48-1536, OpenGL ES 3.2)')).toBe(
      true,
    );
    expect(isPowerVr('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(false);
    expect(isPowerVr(null)).toBe(false);
  });
});
