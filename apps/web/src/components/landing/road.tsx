"use client";

// The road along the footer: painted Classic tiles whose roads join edge to edge, from
// one cloister to another, with the five player meeples walking it. They hop in turn
// once the strip has blurred in (CSS), and again whenever a pointer arrives (WAAPI, so
// a hop that is already running is never restarted from scratch).

import { useRef, type CSSProperties } from "react";

import { FigureIcon, PLAYER_COLORS, PLAYER_COLOR_ORDER } from "@carcassonne/render-classic";

/** `tier` 0 tiles always show; 1 joins from 768 px, 2 from 1100 px (whole tiles only). */
const ROAD: { tile: string; tier: 0 | 1 | 2 }[] = [
  { tile: "A3", tier: 0 },
  { tile: "U1", tier: 0 },
  { tile: "D0", tier: 1 },
  { tile: "W0", tier: 0 },
  { tile: "U1", tier: 2 },
  { tile: "X0", tier: 1 },
  { tile: "U1", tier: 0 },
  { tile: "L0", tier: 2 },
  { tile: "D0", tier: 1 },
  { tile: "U1", tier: 2 },
  { tile: "W2", tier: 0 },
  { tile: "U1", tier: 1 },
  { tile: "D0", tier: 2 },
  { tile: "A1", tier: 0 },
];

const WALKERS = PLAYER_COLOR_ORDER.slice(0, 5).map((id) => PLAYER_COLORS[id]);

const HOP: Keyframe[] = [
  { transform: "none" },
  { transform: "scale(1.06, 0.92)", offset: 0.18 },
  { transform: "translateY(-34%) scale(0.97, 1.04)", offset: 0.45 },
  { transform: "scale(1.04, 0.96)", offset: 0.8 },
  { transform: "none" },
];

export function FooterRoad() {
  const ref = useRef<HTMLDivElement>(null);
  const hop = () => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true") return;
    root.querySelectorAll<HTMLElement>(".lp-walker").forEach((el, i) => {
      if (el.getAnimations().some((a) => a.playState === "running")) return;
      el.animate(HOP, { duration: 560, delay: i * 90, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    });
  };
  return (
    <div
      ref={ref}
      className="lp-road"
      data-reveal
      role="img"
      aria-label="Five meeples, one in each player colour, walking a road of painted tiles between two cloisters."
      onPointerEnter={(e) => e.pointerType === "mouse" && hop()}
    >
      <div className="lp-road-tiles" aria-hidden="true">
        {ROAD.map((t, i) => (
          <img key={i} className="lp-road-tile" data-tier={t.tier} src={`/landing/tiles/${t.tile}.webp`} alt="" width={384} height={384} loading="lazy" decoding="async" />
        ))}
      </div>
      <div className="lp-road-walkers" aria-hidden="true">
        {WALKERS.map((p, i) => (
          <span key={p.id} className="lp-walker" style={{ "--i": i } as CSSProperties}>
            <FigureIcon fill={p.fill} ink={p.ink} marker={p.marker} size={40} outline="rgba(30,14,0,0.6)" />
          </span>
        ))}
      </div>
    </div>
  );
}
