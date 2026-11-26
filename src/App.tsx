import { useEffect, useRef, useState } from 'react';
import { HUD } from './components/HUD';
import { installDebugApi } from './engine/debug';
import { Game } from './engine/Game';
import { installMobileGuards } from './utils/mobileGuards';

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => installMobileGuards(), []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const g = new Game(el);
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
    </div>
  );
}
