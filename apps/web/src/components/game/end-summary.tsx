"use client";

import { Castle, Church, Crown, Flower2, Route, Wheat } from "lucide-react";

import type { GameView } from "@carcassonne/protocol";
import type { PlayerMeta } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { playerName } from "./helpers";

const COLS = [
  { key: "road", label: "Roads", icon: Route },
  { key: "city", label: "Cities", icon: Castle },
  { key: "cloister", label: "Cloisters", icon: Church },
  { key: "garden", label: "Gardens", icon: Flower2 },
  { key: "field", label: "Fields", icon: Wheat },
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="relative bg-[linear-gradient(135deg,var(--felt),color-mix(in_oklch,var(--felt)_60%,black))] px-6 py-7 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Final score</div>
          <h2 id="end-title" className="mt-1 font-display text-4xl">
            {winners.length > 1 ? "A shared victory!" : `${playerName(players, winners[0]?.i)} wins!`}
          </h2>
          <p className="mt-1 text-sm text-white/80">
            {winners.map((w) => playerName(players, w.i)).join(" & ")} with {best} points
          </p>
          <Crown className="absolute top-6 right-6 size-14 text-gold drop-shadow" aria-hidden />
        </div>
        <div className="overflow-x-auto px-4 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pl-2 font-medium">#</th>
                <th className="py-2 font-medium">Player</th>
                {cols.map((c) => (
                  <th key={c.key} className="py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <c.icon className="size-3.5" aria-hidden />
                      {c.label}
                    </span>
                  </th>
                ))}
                <th className="py-2 pr-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.map((p, rank) => {
                const meta = players[p.i];
                const app = PLAYER_COLORS[meta?.color ?? "red"];
                return (
                  <tr key={p.i} className={cn("border-t border-border/60", p.score === best && "bg-accent/50")}>
                    <td className="py-2.5 pl-2 font-display text-lg text-muted-foreground">{rank + 1}</td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <FigureIcon fill={app.fill} ink={app.ink} marker={app.marker} size={20} />
                        {playerName(players, p.i)}
                      </span>
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="py-2.5 text-right tabular-nums">
                        {p.breakdown[c.key]}
                      </td>
                    ))}
                    <td className="py-2.5 pr-2 text-right font-display text-xl tabular-nums">{p.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-muted/40 px-5 py-4">
          <button type="button" className="mr-auto text-sm text-muted-foreground hover:text-foreground" onClick={onClose}>
            View board
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
