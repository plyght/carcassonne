"use client";

// Tile rotation dial: a DialKit-styled knob with four detents (0°, 90°, 180°, 270°)
// around the tile in hand. Drag around the ring, scroll over it, click a detent (or
// the tile, for a clockwise quarter turn), or use the arrow keys when it has focus; R
// rotates from anywhere (the game screen's shortcut). The knob and the tile spring to
// the new detent. Detents that are legal at the hovered spot are marked.
//
// The tile art is painted at its rotation (houses and lighting stay upright), so the
// spring only animates the *difference* to the new detent: the freshly painted tile
// starts turned back by that amount and springs to rest.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

import { cn } from "@carcassonne/ui/lib/utils";

const SPRING = { type: "spring", visualDuration: 0.38, bounce: 0.38 } as const;

export function RotationDial({
  rot,
  onRotate,
  legal,
  disabled,
  size = 132,
  tileSize = 80,
  label = "Tile rotation",
  children,
  className,
}: {
  /** Quarter turns clockwise, 0–3. */
  rot: number;
  onRotate(dir: 1 | -1): void;
  /** Rotations that are legal right now (marked on the ring); all when omitted. */
  legal?: number[];
  disabled?: boolean;
  size?: number;
  tileSize?: number;
  label?: string;
  /** The tile art, drawn at `rot`. */
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const lastDir = useRef<1 | -1>(1);
  const [angle, setAngle] = useState(rot * 90);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; sector: number; x: number; y: number; moved: boolean } | null>(null);

  // continuous angle: follow `rot` the short way round (or the way the user turned)
  useEffect(() => {
    setAngle((a) => {
      const cur = (((Math.round(a / 90) % 4) + 4) % 4) as number;
      let d = (rot - cur + 4) % 4;
      if (d === 3) d = -1;
      else if (d === 2) d = 2 * lastDir.current;
      return a + d * 90;
    });
  }, [rot]);

  const target = useMotionValue(angle);
  const knob = useSpring(angle, SPRING);
  useEffect(() => {
    target.set(angle);
    if (reduced) knob.jump(angle);
    else knob.set(angle);
  }, [angle, reduced, target, knob]);
  const tileTurn = useTransform(() => knob.get() - target.get());

  const turn = (d: 1 | -1) => {
    if (disabled) return;
    lastDir.current = d;
    onRotate(d);
  };

  // wheel (non-passive so the page doesn't scroll)
  const turnRef = useRef(turn);
  useEffect(() => {
    turnRef.current = turn;
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - last < 130 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 2) return;
      last = now;
      turnRef.current((e.deltaY || e.deltaX) > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const sectorAt = (clientX: number, clientY: number) => {
    const r = host.current!.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, clockwise
    return { sector: (((Math.round(a / 90) % 4) + 4) % 4) as number, dist: Math.hypot(dx, dy) };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sector: sectorAt(e.clientX, e.clientY).sector, x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.moved = true;
      setDragging(true);
    }
    if (!d.moved) return;
    const { sector } = sectorAt(e.clientX, e.clientY);
    if (sector === d.sector) return;
    const diff = (sector - d.sector + 4) % 4;
    d.sector = sector;
    if (diff === 1) turn(1);
    else if (diff === 3) turn(-1);
    else {
      turn(lastDir.current);
      turn(lastDir.current);
    }
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) return;
    // a click: on the ring, rotate towards that detent; on the tile, a clockwise quarter turn
    const { sector, dist } = sectorAt(e.clientX, e.clientY);
    if (dist < tileSize * 0.5) return turn(1);
    const diff = (sector - rot + 4) % 4;
    if (diff === 1) turn(1);
    else if (diff === 3) turn(-1);
    else if (diff === 2) {
      turn(1);
      turn(1);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") turn(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") turn(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const c = size / 2;
  const ringR = c - 5;
  const legalSet = new Set(legal ?? [0, 1, 2, 3]);

  return (
    <div
      ref={host}
      className={cn("carc-rot", className)}
      style={{ width: size, height: size }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={270}
      aria-valuenow={rot * 90}
      aria-valuetext={`${rot * 90}° clockwise`}
      aria-keyshortcuts="R"
      data-rot={rot}
      data-testid="rotation-dial"
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={onKey}
    >
      <svg className="carc-rot-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="carc-rot-ring" cx={c} cy={c} r={ringR} />
        {[0, 1, 2, 3].map((k) => {
          const a = (k * Math.PI) / 2;
          const sx = Math.sin(a);
          const sy = -Math.cos(a);
          return (
            <line
              key={k}
              className="carc-rot-tick"
              data-legal={legal && legalSet.has(k) ? "true" : undefined}
              x1={c + sx * (ringR - 9)}
              y1={c + sy * (ringR - 9)}
              x2={c + sx * (ringR - 3)}
              y2={c + sy * (ringR - 3)}
              opacity={legalSet.has(k) ? 1 : 0.45}
            />
          );
        })}
      </svg>
      {/* knob riding the ring */}
      <motion.div aria-hidden style={{ position: "absolute", inset: 0, rotate: knob, pointerEvents: "none" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <circle className="carc-rot-knob" cx={c} cy={c - ringR} r={6.5} />
        </svg>
      </motion.div>
      <motion.div
        className="carc-rot-tile"
        style={{ width: tileSize, height: tileSize, left: c - tileSize / 2, top: c - tileSize / 2, rotate: tileTurn, opacity: disabled ? 0.92 : 1 }}
      >
        {children}
      </motion.div>
      <motion.span key={rot} className="carc-rot-label" initial={reduced ? false : { scale: 0.85, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING} aria-hidden>
        {rot * 90}°
      </motion.span>
    </div>
  );
}
