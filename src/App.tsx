import { useEffect, useRef, useState } from 'react';
import { GraphicsProblem } from './components/GraphicsProblem';
import { HUD } from './components/HUD';
import { StartupError, StartupErrorBoundary } from './components/StartupError';
import { installDebugApi } from './engine/debug';
import { Game } from './engine/Game';
import { installMobileGuards } from './utils/mobileGuards';

function GameView() {
  const container = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [startupError, setStartupError] = useState<unknown>(null);

  useEffect(() => installMobileGuards(), []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let g: Game;
    try {
      g = new Game(el);
    } catch (err) {
      // No WebGL (or any other start-up failure): show a message instead of unmounting into a blank page.
      console.error('Game failed to start', err);
      el.replaceChildren();
      // oxlint-disable-next-line react/set-state-in-effect -- reporting a failure of the external WebGL context
      setStartupError(err);
      return;
    }
    const uninstallDebug = installDebugApi(g);
    setGame(g);
    return () => {
      uninstallDebug();
      g.dispose();
      setGame(null);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="absolute inset-0" />
      {game && <HUD actions={game} />}
      <GraphicsProblem />
      {startupError !== null && <StartupError error={startupError} />}
    </div>
  );
}

export function App() {
  return (
    <StartupErrorBoundary>
      <GameView />
    </StartupErrorBoundary>
  );
}
