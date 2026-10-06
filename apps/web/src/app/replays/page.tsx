"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { Film, Trash2 } from "reicon-react";

import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";

import { deleteGame, listGames, type LocalGameRecord } from "@/lib/local-games";

export default function ReplaysPage() {
  const [games, setGames] = useState<LocalGameRecord[] | null>(null);
  useEffect(() => setGames(listGames()), []);

  return (
    <div className="carc-page reveal" data-width="wide">
      <h1 className="carc-page-title">Replays</h1>
      <p className="carc-page-lead">
        Every game is stored as its seed and moves, and re-simulated by the engine. Online replays appear here once the server is connected.
      </p>
      <div className="mt-[var(--sp-6)]">
        {games === null ? null : games.length === 0 ? (
          <div className="carc-sheet carc-empty">
            <Film aria-hidden />
            <p className="carc-title">No games yet</p>
            <p className="carc-sub">Finished and in-progress games on this device show up here.</p>
            <Link href="/play/new" className="carc-btn mt-[var(--sp-2)]" data-variant="primary">
              Play one
            </Link>
          </div>
        ) : (
          <ul className="carc-list gap-[var(--sp-3)]!">
            {games.map((g) => {
              const best = Math.max(0, ...g.scores);
              const ended = g.status === "ended";
              return (
                <li key={g.id} className="carc-sheet carc-replay-item">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[var(--sp-2)]">
                      <span className="carc-title">{g.mode === "hotseat" ? "Hot-seat" : g.mode === "tutorial" ? "Tutorial" : "vs AI"}</span>
                      <span className="carc-tag" data-tone={ended ? undefined : "accent"}>
                        {ended ? "Finished" : "In progress"}
                      </span>
                    </div>
                    <div className="carc-replay-meta carc-num">
                      {new Date(g.updatedAt).toLocaleString()} · {g.moves.length} turns · seed <span className="font-mono">{g.seed}</span>
                    </div>
                    <ul className="carc-replay-players">
                      {g.players.map((p, i) => {
                        const a = PLAYER_COLORS[p.color];
                        const won = g.scores[i] === best && ended;
                        return (
                          <li key={i} data-won={won || undefined}>
                            <FigureIcon fill={a.fill} ink={a.ink} marker={a.marker} size={18} />
                            <span className="carc-replay-name">{p.name}</span>
                            <span className="carc-replay-score carc-num">{g.scores[i] ?? 0}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="carc-replay-actions">
                    {g.status === "playing" ? (
                      <Link href={`/play/local/${g.id}` as Route} className="carc-btn">
                        Resume
                      </Link>
                    ) : null}
                    <Link href={`/replays/${g.id}` as Route} className="carc-btn" data-variant="primary">
                      Watch
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        deleteGame(g.id);
                        setGames(listGames());
                      }}
                      className="carc-icon-btn"
                      data-variant="danger"
                      aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
