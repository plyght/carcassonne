"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { Film, Trash2 } from "lucide-react";

import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";

import { deleteGame, listGames, type LocalGameRecord } from "@/lib/local-games";

export default function ReplaysPage() {
  const [games, setGames] = useState<LocalGameRecord[] | null>(null);
  useEffect(() => setGames(listGames()), []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-4xl tracking-tight">Replays</h1>
      <p className="mt-1 text-muted-foreground">
        Every game is stored as its seed and moves, and re-simulated by the engine. Online replays appear here once the server is connected.
      </p>
      <div className="mt-6 grid gap-3">
        {games === null ? null : games.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <Film className="mx-auto mb-2 size-8" />
            No games yet.{" "}
            <Link href="/play/new" className="font-semibold text-primary underline">
              Play one
            </Link>
          </div>
        ) : (
          games.map((g) => {
            const best = Math.max(0, ...g.scores);
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg">{g.mode === "hotseat" ? "Hot-seat" : g.mode === "tutorial" ? "Tutorial" : "vs AI"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${g.status === "ended" ? "bg-secondary" : "bg-primary/15 text-primary"}`}>
                      {g.status === "ended" ? "finished" : "in progress"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(g.updatedAt).toLocaleString()} · {g.moves.length} turns · seed <span className="font-mono">{g.seed}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {g.players.map((p, i) => {
                      const a = PLAYER_COLORS[p.color];
                      return (
                        <span key={i} className={`inline-flex items-center gap-1 text-sm ${g.scores[i] === best && g.status === "ended" ? "font-semibold" : ""}`}>
                          <FigureIcon fill={a.fill} ink={a.ink} marker={a.marker} size={16} />
                          {p.name} <span className="tabular-nums text-muted-foreground">{g.scores[i] ?? 0}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {g.status === "playing" ? (
                    <Link href={`/play/local/${g.id}` as Route} className="rounded-xl border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                      Resume
                    </Link>
                  ) : null}
                  <Link href={`/replays/${g.id}` as Route} className="rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                    Watch
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      deleteGame(g.id);
                      setGames(listGames());
                    }}
                    className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
