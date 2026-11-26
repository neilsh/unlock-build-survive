import { Component, type ReactNode } from 'react';
import { formatGraphicsReport } from '../utils/graphicsReport';
import { WebGLUnavailableError } from '../utils/webglUnavailable';

/** Kid-readable headline plus the grown-up detail for a failed start. */
export function describeStartupError(error: unknown): { headline: string; hint: string; detail: string } {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof WebGLUnavailableError) {
    return {
      headline: "This device can't draw the 3D island",
      hint: 'Disaster Village needs WebGL. If it worked a moment ago, Chrome may have switched WebGL off after the graphics crashed: close this tab (or restart Chrome) and open the link again. Otherwise close other tabs and apps, update your browser, then reload.',
      detail,
    };
  }
  return {
    headline: 'Disaster Village hit a snag starting up',
    hint: 'Reloading usually fixes it. If it keeps happening, tell a grown-up and show them the details below.',
    detail,
  };
}

/** Full-screen message shown instead of a blank page when the game cannot start. */
export function StartupError({ error }: { error: unknown }) {
  const { headline, hint, detail } = describeStartupError(error);
  return (
    <div
      role="alert"
      data-testid="startup-error"
      className="ubs-pad-safe absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-sky-100 text-center text-slate-800"
    >
      <h1 className="text-2xl font-bold">{headline}</h1>
      <p className="max-w-md text-base">{hint}</p>
      <button
        type="button"
        data-testid="startup-error-reload"
        onClick={() => globalThis.location.reload()}
        className="rounded-xl bg-sky-600 px-5 py-3 text-lg font-semibold text-white active:bg-sky-700"
      >
        Reload
      </button>
      <p
        data-testid="startup-error-detail"
        className="max-w-md break-words text-xs text-slate-500 [user-select:text] select-text"
      >
        {detail}
      </p>
      <pre
        data-testid="startup-error-report"
        className="max-w-md whitespace-pre-wrap break-words text-left text-[11px] text-slate-500 [user-select:text] select-text"
      >
        {formatGraphicsReport()}
      </pre>
    </div>
  );
}

/** Catches anything that throws while React renders so the page never goes blank. */
export class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Unknown error') };
  }

  override render() {
    return this.state.error ? <StartupError error={this.state.error} /> : this.props.children;
  }
}
