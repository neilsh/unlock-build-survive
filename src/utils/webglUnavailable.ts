/** Thrown when no WebGL context could be created at all. `reasons` lists what each attempt reported. */
export class WebGLUnavailableError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`WebGL is not available: ${reasons.join(' | ') || 'unknown reason'}`);
    this.name = 'WebGLUnavailableError';
    this.reasons = reasons;
  }
}
