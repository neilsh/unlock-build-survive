import { useEffect, useState } from 'react';
import { useUIState } from '../state/store';
import { formatGraphicsReport } from '../utils/graphicsReport';

/** Brief hiccups (the GPU hands the context straight back) stay invisible; longer ones get a message. */
const SHOW_AFTER_MS = 1500;

/**
 * Shown when the 3D view has stopped drawing (lost WebGL context, or frames that keep failing), so a frozen or
 * blank view always has a visible explanation and a way out.
 */
export function GraphicsProblem() {
  const problem = useUIState((s) => s.graphicsProblem);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (problem === 'none') {
      const hide = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hide);
    }
    const show = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(show);
  }, [problem]);

  if (problem === 'none' || !visible) return null;
  return (
    <div
      role="alert"
      data-testid="graphics-problem"
      className="ubs-pad-safe absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-sky-100/95 text-center text-slate-800"
    >
      <h2 className="text-2xl font-bold">The 3D view stopped</h2>
      <p className="max-w-md text-base">
        {problem === 'lost'
          ? 'Your phone paused the picture (it can do that when the browser is in the background or the phone is busy). It may come back by itself. If it does not, reload (the game then starts in a plainer graphics mode). If Reload shows an error, close this tab or restart Chrome.'
          : 'The picture got stuck. Reloading usually fixes it.'}
      </p>
      <pre
        data-testid="graphics-problem-report"
        className="max-w-md whitespace-pre-wrap break-words text-left text-[11px] text-slate-500 [user-select:text] select-text"
      >
        {formatGraphicsReport()}
      </pre>
      <button
        type="button"
        data-testid="graphics-problem-reload"
        onClick={() => globalThis.location.reload()}
        className="rounded-xl bg-sky-600 px-5 py-3 text-lg font-semibold text-white active:bg-sky-700"
      >
        Reload
      </button>
    </div>
  );
}
