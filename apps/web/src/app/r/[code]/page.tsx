"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { Bot, Check, Copy, Loader2, Play, User } from "lucide-react";

import { FigureIcon, PLAYER_COLOR_ORDER, PLAYER_COLORS } from "@carcassonne/render-classic";
import type { PlayerColorId } from "@carcassonne/game-client";

import { EDITION_TEXT } from "@/components/setup/rules-form";
import { authClient } from "@/lib/auth-client";
import { roomApi, type Room } from "@/lib/rooms-api";
import { readJSON, writeJSON } from "@/lib/storage";

export default function RoomLobby() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => readJSON("carc.nickname", ""));
  const [joined, setJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await roomApi.get({ code });
        if (!alive) return;
        setRoom(r);
        setError(null);
        if (r.status === "playing" && r.gameId) router.push(`/play/online/${r.gameId}` as Route);
      } catch (e) {
        if (alive) setError((e as Error).message || "Server unavailable");
      }
    };
    void load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code, router]);

  const join = async () => {
    try {
      writeJSON("carc.nickname", nickname);
      setRoom(await roomApi.join({ code, nickname: session ? undefined : nickname || undefined }));
      setJoined(true);
    } catch (e) {
      setError((e as Error).message || "Couldn’t join");
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      const { gameId } = await roomApi.start({ code });
      router.push(`/play/online/${gameId}` as Route);
    } catch (e) {
      setError((e as Error).message || "Couldn’t start");
      setStarting(false);
    }
  };

  const [link, setLink] = useState(`/r/${code}`);
  useEffect(() => setLink(`${window.location.origin}/r/${code}`), [code]);
  const isHost = !!room && !!session && room.hostUserId === session.user.id;
  const seats = room?.seats ?? Array.from({ length: 4 }, (_, i) => ({ seat: i, kind: "open" as const, name: null, userId: null, color: null }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Room</div>
      <h1 className="font-display text-5xl tracking-[0.12em]">{code}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-card/80 p-2 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground" suppressHydrationWarning>
          {link}
        </span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}. The room service may not be running yet; this page retries automatically.
        </div>
      ) : null}

      <section className="mt-6 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="mb-3 font-display text-2xl">Seats</h2>
        <ol className="grid gap-2 sm:grid-cols-2">
          {seats.map((s) => {
            const color = (s.color as PlayerColorId | null) ?? PLAYER_COLOR_ORDER[s.seat]!;
            const app = PLAYER_COLORS[color] ?? PLAYER_COLORS.red;
            return (
              <li key={s.seat} className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/60 p-3">
                <FigureIcon fill={s.kind === "open" ? "transparent" : app.fill} outline={s.kind === "open" ? "currentColor" : undefined} ink={app.ink} marker={app.marker} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.kind === "open" ? "Open seat" : (s.name ?? "Player")}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {s.kind === "bot" ? <Bot className="size-3" /> : s.kind === "human" ? <User className="size-3" /> : null}
                    {s.kind === "bot" ? `Bot · ${s.tier ?? "medium"}` : s.kind === "human" ? (s.connected === false ? "away" : "ready") : "waiting…"}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {!joined ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!session ? (
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                placeholder="Your nickname"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                aria-label="Nickname"
              />
            ) : null}
            <button type="button" onClick={join} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Take a seat
            </button>
          </div>
        ) : null}
        {isHost ? (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Start game
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">The host starts the game when everyone is seated.</p>
        )}
      </section>

      {room ? (
        <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 text-sm shadow-sm">
          <h2 className="mb-2 font-display text-2xl">Rules</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>Field scoring, {["", "1st", "2nd", "3rd"][room.ruleset.fieldEdition]} edition: {EDITION_TEXT[room.ruleset.fieldEdition]}</li>
            <li>The River: {room.ruleset.river ? "on" : "off"}</li>
            <li>The Abbot: {room.ruleset.abbot ? "on" : "off"}</li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
