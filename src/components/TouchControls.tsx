/**
 * On-screen controls for touch devices: a move joystick (bottom-left) and Jump / Build / Break / Fire
 * buttons (bottom-right). They feed the same paths as keyboard and gamepad through GameActions; looking
 * around is a one-finger drag on the 3D view (see FirstPersonController). Everything keeps clear of the
 * notch and home-indicator insets and works with several fingers at once (steer + look + act).
 */
import {
  ChevronsUp,
  Crosshair,
  DoorOpen,
  Eraser,
  Hammer,
  Paintbrush,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useUIState } from '../state/store';
import type { ToolType } from '../types/blueprint';
import type { GameActions } from '../types/ui';

/** How far (px) the stick knob travels from the centre; full deflection = 1. */
const RADIUS = 40;
const DEAD_ZONE = 0.12;

const SAFE_BOTTOM = 'max(0.75rem, env(safe-area-inset-bottom))';
const SAFE_LEFT = 'max(0.75rem, env(safe-area-inset-left))';
const SAFE_RIGHT = 'max(0.75rem, env(safe-area-inset-right))';

const BUILD_BUTTON: Record<ToolType, { label: string; Icon: LucideIcon }> = {
  block: { label: 'Build', Icon: Hammer },
  brace: { label: 'Brace', Icon: Waypoints },
  paint: { label: 'Paint', Icon: Paintbrush },
  erase: { label: 'Erase', Icon: Eraser },
};

interface ActionButtonProps {
  testId: string;
  label: string;
  Icon: LucideIcon;
  onPress: () => void;
  className: string;
}

/** Big round touch button that fires on finger-down (no click delay) and still works from a keyboard. */
function ActionButton({ testId, label, Icon, onPress, className }: ActionButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      // Keyboard / assistive activation has no pointer-down (detail === 0); real taps already fired above.
      onClick={(e) => {
        if (e.detail === 0) onPress();
      }}
      style={{ touchAction: 'none' }}
      className={`pointer-events-auto absolute flex flex-col items-center justify-center gap-0.5 rounded-full border-4 border-white/70 text-[11px] font-black leading-none shadow-lg backdrop-blur-sm active:scale-90 ${className}`}
    >
      <Icon size={22} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function TouchControls({ actions }: { actions: GameActions }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const s = useUIState((u) => ({
    mode: u.mode,
    exploreMode: u.exploreMode,
    tool: u.tool,
    weapon: u.equippedWeapon,
  }));

  useEffect(
    () => () => {
      actions.setTouchMove(0, 0);
      actions.setTouchJump(false);
    },
    [actions],
  );

  const update = (e: ReactPointerEvent) => {
    const el = baseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < DEAD_ZONE) actions.setTouchMove(0, 0);
    else actions.setTouchMove(nx, -ny);
  };

  const end = (e: ReactPointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    actions.setTouchMove(0, 0);
  };

  const building = s.mode === 'build';
  const build = s.exploreMode ? { label: 'Door', Icon: DoorOpen } : BUILD_BUTTON[s.tool];
  // While a disaster runs the main button fires the equipped weapon (if any); otherwise it can open doors.
  const mainButton = building ? build : s.weapon ? { label: 'Fire', Icon: Crosshair } : null;
  const showBreak = building && !s.exploreMode && s.tool !== 'erase';

  return (
    <div
      data-testid="touch-controls"
      className="pointer-events-none fixed inset-0 z-10 select-none"
      style={{ WebkitTouchCallout: 'none' }}
    >
      {/* Joystick: the hit area is larger than the ring so a thumb that drifts off it keeps steering. */}
      <div
        ref={baseRef}
        data-testid="touch-joystick"
        role="group"
        aria-label="Move joystick"
        onPointerDown={(e) => {
          if (activeId.current !== null) return;
          activeId.current = e.pointerId;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          update(e);
        }}
        onPointerMove={(e) => {
          if (activeId.current === e.pointerId) update(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ touchAction: 'none', left: SAFE_LEFT, bottom: SAFE_BOTTOM }}
        className="pointer-events-auto absolute flex size-36 items-center justify-center rounded-full"
      >
        <div className="size-28 rounded-full border-4 border-white/70 bg-sky-900/30 backdrop-blur-sm" />
        <div
          className="absolute left-1/2 top-1/2 -ml-6 -mt-6 size-12 rounded-full bg-white/90 shadow-lg"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>

      <div
        className="absolute size-44"
        style={{ right: SAFE_RIGHT, bottom: SAFE_BOTTOM }}
        data-testid="touch-buttons"
      >
        <button
          type="button"
          data-testid="touch-jump"
          aria-label="Jump"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            actions.setTouchJump(true);
          }}
          onPointerUp={() => actions.setTouchJump(false)}
          onPointerCancel={() => actions.setTouchJump(false)}
          style={{ touchAction: 'none' }}
          className="pointer-events-auto absolute bottom-0 right-0 flex size-20 flex-col items-center justify-center gap-0.5 rounded-full border-4 border-white/70 bg-amber-400/85 text-[11px] font-black text-amber-950 shadow-lg active:scale-90"
        >
          <ChevronsUp size={24} aria-hidden="true" />
          <span>Jump</span>
        </button>
        {mainButton && (
          <ActionButton
            testId="touch-build"
            label={mainButton.label}
            Icon={mainButton.Icon}
            onPress={() => actions.touchPrimary()}
            className="bottom-2 right-[5.5rem] size-[4.5rem] bg-emerald-400/90 text-emerald-950"
          />
        )}
        {showBreak && (
          <ActionButton
            testId="touch-break"
            label="Break"
            Icon={Eraser}
            onPress={() => actions.touchSecondary()}
            className="bottom-[5.5rem] right-2 size-16 bg-rose-300/90 text-rose-950"
          />
        )}
      </div>
    </div>
  );
}
