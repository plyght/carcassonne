"use client";

import { useEffect, useRef } from "react";

import { Eye } from "reicon-react";

import type { PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLORS } from "@carcassonne/render-classic";

import { SeatSwatch } from "./hud-parts";

/** Hot-seat: hide the next tile until the next player is at the device (PRD §6.1). */
export function PassDevice({ player, meta, onReveal }: { player: number; meta: PlayerMeta | undefined; onReveal(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const app = PLAYER_COLORS[meta?.color ?? "red"];
  return (
    <div className="carc-pass" role="dialog" aria-modal="true" aria-labelledby="pass-title">
      <div className="carc-pass-card carc-dialog">
        <span className="carc-pass-avatar">
          <SeatSwatch color={meta?.color ?? "red"} size={72} title={`${app.label} player`} />
        </span>
        <div className="carc-eyebrow">Pass the device</div>
        <h2 id="pass-title" className="carc-heading">
          {meta?.name ?? `Player ${player + 1}`}, you’re up
        </h2>
        <p className="carc-sub">Your tile stays hidden until you’re ready.</p>
        <button ref={ref} type="button" onClick={onReveal} className="carc-btn" data-variant="primary" data-size="large">
          <Eye /> I’m ready, show my tile
        </button>
      </div>
    </div>
  );
}
