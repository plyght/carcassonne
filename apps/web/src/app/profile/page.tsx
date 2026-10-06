"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import type { PlayerColorId } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLOR_ORDER, PLAYER_COLORS } from "@carcassonne/render-classic";

import { authClient } from "@/lib/auth-client";
import { listGames, type LocalGameRecord } from "@/lib/local-games";
import { profileApi, type Profile } from "@/lib/rooms-api";
import { readJSON, writeJSON } from "@/lib/storage";

export default function ProfilePage() {
  const { data: session } = authClient.useSession();
  const [games, setGames] = useState<LocalGameRecord[]>([]);
  const [server, setServer] = useState<Profile | null>(null);
  const [color, setColor] = useState<PlayerColorId>("blue");

  useEffect(() => {
    setGames(listGames());
    setColor(readJSON<PlayerColorId>("carc.preferredColor", "blue"));
    profileApi
      .me()
      .then(setServer)
      .catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const done = games.filter((g) => g.status === "ended");
    let wins = 0;
    let total = 0;
    for (const g of done) {
      const me = g.players.findIndex((p) => p.kind === "human");
      if (me < 0) continue;
      total += g.scores[me] ?? 0;
      if ((g.scores[me] ?? 0) === Math.max(...g.scores)) wins++;
    }
    return { played: done.length, wins, avg: done.length ? Math.round(total / done.length) : 0 };
  }, [games]);

  const app = PLAYER_COLORS[color];
  const MODE_LABEL: Record<string, string> = { ai: "vs AI", hotseat: "Hot-seat", tutorial: "Tutorial" };
  return (
    <div className="carc-page">
      <div className="flex items-center gap-[var(--sp-4)]">
        <span className="carc-pass-avatar mb-0!" style={{ ["--seat" as string]: app.fill, width: 80, height: 80 }}>
          <FigureIcon fill={app.fill} ink={app.ink} marker={app.marker} size={52} />
        </span>
        <div className="min-w-0">
          <h1 className="carc-page-title truncate">{server?.displayName ?? session?.user.name ?? "Guest"}</h1>
          <p className="carc-page-lead mt-[var(--sp-1)]!">
            {session ? (
              session.user.email
            ) : (
              <>
                Playing as a guest.{" "}
                <Link href="/login" className="carc-link">
                  Sign in
                </Link>{" "}
                for ranked play and synced stats.
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="carc-stats mt-[var(--sp-6)]">
        {[
          ["Games", server?.stats.games ?? stats.played],
          ["Wins", server?.stats.wins ?? stats.wins],
          ["Avg. score", server ? Math.round(server.stats.averageScore) : stats.avg],
          ["Rating", server?.ratings.length ? `${Math.round(Math.max(...server.ratings.map((r) => r.rating)))}` : "—"],
        ].map(([k, v]) => (
          <div key={k as string} className="carc-sheet carc-stat">
            <dt className="carc-eyebrow">{k}</dt>
            <dd className="carc-stat-value">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="carc-sheet mt-[var(--sp-6)]">
        <h2 className="carc-heading">Meeple colour</h2>
        <p className="carc-sub">Your preferred colour when a room has it free.</p>
        <div className="mt-[var(--sp-4)] flex flex-wrap gap-[var(--sp-2)]" role="radiogroup" aria-label="Meeple colour">
          {PLAYER_COLOR_ORDER.map((c) => {
            const a = PLAYER_COLORS[c];
            return (
              <button
                key={c}
                type="button"
                role="radio"
                onClick={() => {
                  setColor(c);
                  writeJSON("carc.preferredColor", c);
                }}
                className="carc-swatch"
                aria-label={a.label}
                aria-checked={color === c}
                style={{ ["--seat" as string]: a.fill }}
              >
                <FigureIcon fill={a.fill} ink={a.ink} marker={a.marker} size={32} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="carc-sheet mt-[var(--sp-6)]">
        <div className="carc-section-head">
          <h2 className="carc-heading">Recent games</h2>
          <Link href="/replays" className="carc-link text-[length:var(--fs-body)]">
            All replays
          </Link>
        </div>
        <ul className="carc-list mt-[var(--sp-4)]">
          {games.slice(0, 5).map((g) => (
            <li key={g.id} className="carc-row justify-between">
              <span className="font-medium">
                {MODE_LABEL[g.mode] ?? g.mode} <span className="text-[var(--text-2)]">· {g.players.length} players</span>
              </span>
              <span className="carc-num text-[length:var(--fs-small)] text-[var(--text-2)]">
                {g.status === "ended" ? `Final ${g.scores.join(" / ")}` : `Turn ${g.moves.length + 1}`}
              </span>
            </li>
          ))}
          {games.length === 0 ? <li className="carc-hint">No games yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
