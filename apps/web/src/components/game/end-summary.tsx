"use client";

import { useRef } from "react";

import { Castle, Bell, Crown, Leaf, Routing, Tree } from "reicon-react";

import type { GameView } from "@carcassonne/protocol";
import type { PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLORS } from "@carcassonne/render-classic";

import { useReveal } from "@/components/reveal";

import { SeatSwatch } from "./hud-parts";

import { playerName } from "./helpers";

const COLS = [
  { key: "road", label: "Roads", icon: Routing },
  { key: "city", label: "Cities", icon: Castle },
  { key: "cloister", label: "Cloisters", icon: Bell },
  { key: "garden", label: "Gardens", icon: Leaf },
  { key: "field", label: "Fields", icon: Tree },
] as const;

export function EndSummary({
  view,
  players,
  actions,
  onClose,
}: {
  view: GameView;
  players: PlayerMeta[];
  actions: React.ReactNode;
  onClose(): void;
}) {
  const order = view.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
  const best = order[0]?.score ?? 0;
  const winners = order.filter((p) => p.score === best);
  const cols = COLS.filter((c) => c.key !== "garden" || view.ruleset.abbot);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div className="carc-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div ref={ref} className="carc-dialog carc-end reveal">
        <div className="carc-end-banner">
          <div>
            <div className="carc-end-eyebrow">Final score</div>
            <h2 id="end-title" className="carc-end-title">
              {winners.length > 1 ? "A shared victory!" : `${playerName(players, winners[0]?.i)} wins!`}
            </h2>
            <p className="carc-end-sub">
              {winners.map((w) => playerName(players, w.i)).join(" & ")} with <span className="carc-num">{best}</span> points
            </p>
          </div>
          <Crown className="carc-end-crown" aria-hidden />
        </div>
        <div className="carc-end-table-wrap">
          <table className="carc-end-table">
            <thead>
              <tr>
                <th scope="col" className="carc-end-rank">
                  <span className="sr-only">Rank</span>
                </th>
                <th scope="col" className="carc-end-player">
                  Player
                </th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="carc-end-num" title={c.label}>
                    <span className="carc-end-col">
                      <c.icon aria-hidden />
                      <span className="carc-end-col-label">{c.label}</span>
                    </span>
                  </th>
                ))}
                <th scope="col" className="carc-end-num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {order.map((p, rank) => {
                const meta = players[p.i];
                const app = PLAYER_COLORS[meta?.color ?? "red"];
                return (
                  <tr key={p.i} data-winner={p.score === best || undefined}>
                    <td className="carc-end-rank carc-num">{rank + 1}</td>
                    <td className="carc-end-player">
                      <span className="carc-end-name">
                        <SeatSwatch color={meta?.color ?? "red"} size={24} />
                        {playerName(players, p.i)}
                      </span>
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="carc-end-num carc-num">
                        {p.breakdown[c.key]}
                      </td>
                    ))}
                    <td className="carc-end-num carc-end-total carc-num">{p.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="carc-end-actions">
          <button type="button" className="carc-btn carc-end-close" data-variant="ghost" onClick={onClose}>
            View board
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
