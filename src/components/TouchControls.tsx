/**
 * On-screen joystick + jump button, shown only on touch devices. Feeds the same movement path as
 * keyboard/gamepad via GameActions; looking around and tap-to-act reuse the canvas pointer drag.
 */
import { useEffect, useRef, useState } from 'react';
import type { GameActions } from '../types/ui';

const RADIUS = 48;
const DEAD_ZONE = 0.12;

/** True when the primary input is a touch screen (coarse pointer). */
export function useIsTouchDevice(): boolean {
  const query = '(pointer: coarse)';
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setTouch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return touch;
}

export function TouchControls({ actions }: { actions: GameActions }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  useEffect(
    () => () => {
      actions.setTouchMove(0, 0);
      actions.setTouchJump(false);
    },
    [actions],
  );

  const update = (e: React.PointerEvent) => {
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

  const end = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    actions.setTouchMove(0, 0);
  };

  return (
    <div
      data-testid="touch-controls"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 select-none"
    >
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
        style={{ touchAction: 'none' }}
        className="pointer-events-auto absolute bottom-6 left-6 h-32 w-32 rounded-full border-4 border-white/70 bg-sky-900/30 backdrop-blur-sm"
      >
        <div
          className="absolute left-1/2 top-1/2 h-14 w-14 -ml-7 -mt-7 rounded-full bg-white/90 shadow-lg"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      <button
        type="button"
        data-testid="touch-jump"
        aria-label="Jump"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          actions.setTouchJump(true);
        }}
        onPointerUp={() => actions.setTouchJump(false)}
        onPointerCancel={() => actions.setTouchJump(false)}
        style={{ touchAction: 'none' }}
        className="pointer-events-auto absolute bottom-6 right-6 h-20 w-20 rounded-full border-4 border-white/70 bg-amber-400/80 text-sm font-black text-amber-950 shadow-lg active:scale-95"
      >
        Jump
      </button>
    </div>
  );
}
