"use client";

import { useEffect, useRef } from "react";

import type { PlayerMeta } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";

/** Hot-seat: hide the next tile until the next player is at the device (PRD §6.1). */
export function PassDevice({ player, meta, onReveal }: { player: number; meta: PlayerMeta | undefined; onReveal(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const app = PLAYER_COLORS[meta?.color ?? "red"];
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--wood)_85%,black),color-mix(in_oklch,var(--wood)_40%,black))] p-6" role="dialog" aria-modal="true" aria-labelledby="pass-title">
      <div className="max-w-sm text-center text-white">
        <div className="mx-auto mb-4 grid size-24 place-items-center rounded-3xl bg-white/10 ring-1 ring-white/20">
          <FigureIcon fill={app.fill} ink={app.ink} marker={app.marker} size={64} />
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">Pass the device</div>
        <h2 id="pass-title" className="mt-2 font-display text-4xl">
          {meta?.name ?? `Player ${player + 1}`}, you’re up
        </h2>
        <p className="mt-2 text-sm text-white/70">Your tile stays hidden until you’re ready.</p>
        <button
          ref={ref}
          type="button"
          onClick={onReveal}
          className="mt-6 rounded-2xl bg-gold px-6 py-3 font-semibold text-black shadow-lg transition-transform hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-white/50"
        >
          I’m ready, show my tile
        </button>
      </div>
    </div>
  );
}
