"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import type { PlayerColorId } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLOR_ORDER, PLAYER_COLORS } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { authClient } from "@/lib/auth-client";
import { listGames, type LocalGameRecord } from "@/lib/local-games";
import { profileApi, type ProfileStats } from "@/lib/rooms-api";
import { readJSON, writeJSON } from "@/lib/storage";

export default function ProfilePage() {
  const { data: session } = authClient.useSession();
  const [games, setGames] = useState<LocalGameRecord[]>([]);
  const [server, setServer] = useState<ProfileStats | null>(null);
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
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-4">
        <span className="grid size-20 place-items-center rounded-3xl" style={{ background: `${app.fill}22` }}>
          <FigureIcon fill={app.fill} ink={app.ink} marker={app.marker} size={56} />
        </span>
        <div>
          <h1 className="font-display text-4xl tracking-tight">{server?.displayName ?? session?.user.name ?? "Guest"}</h1>
          <p className="text-muted-foreground">
            {session ? session.user.email : (
              <>
                Playing as a guest.{" "}
                <Link href="/login" className="font-semibold text-primary underline">
                  Sign in
                </Link>{" "}
                for ranked play and synced stats.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Games", server?.games ?? stats.played],
          ["Wins", server?.wins ?? stats.wins],
          ["Avg. score", server?.averageScore ?? stats.avg],
          ["Rating", server?.rating ? `${Math.round(server.rating.ffa4)}` : "—"],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl border border-border/80 bg-card/80 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="font-display text-3xl tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="font-display text-2xl">Meeple colour</h2>
        <p className="text-sm text-muted-foreground">Your preferred colour when a room has it free.</p>
        <div className="mt-3 flex gap-3">
          {PLAYER_COLOR_ORDER.map((c) => {
            const a = PLAYER_COLORS[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c);
                  writeJSON("carc.preferredColor", c);
                }}
                className={cn("grid size-14 place-items-center rounded-2xl border-2 transition", color === c ? "border-foreground" : "border-transparent hover:bg-muted")}
                aria-label={a.label}
                aria-pressed={color === c}
              >
                <FigureIcon fill={a.fill} ink={a.ink} marker={a.marker} size={36} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Recent games</h2>
          <Link href="/replays" className="text-sm text-primary underline">
            All replays
          </Link>
        </div>
        <ul className="mt-2 divide-y divide-border/60 text-sm">
          {games.slice(0, 5).map((g) => (
            <li key={g.id} className="flex justify-between py-2">
              <span>
                {g.mode} · {g.players.length} players
              </span>
              <span className="text-muted-foreground">{g.status === "ended" ? `final ${g.scores.join(" / ")}` : `turn ${g.moves.length + 1}`}</span>
            </li>
          ))}
          {games.length === 0 ? <li className="py-2 text-muted-foreground">No games yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
