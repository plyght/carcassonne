"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Copy, Loader2, Play, User } from "lucide-react";

import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";
import type { PlayerColorId } from "@carcassonne/game-client";

import { EDITION_TEXT } from "@/components/setup/rules-form";
import { authClient } from "@/lib/auth-client";
import { getGuest } from "@/lib/guest";
import { roomApi } from "@/lib/rooms-api";
import { readJSON, writeJSON } from "@/lib/storage";
import { queryClient, trpc } from "@/utils/trpc";

/** Seat colours as the server assigns them (packages/api game service). */
const SEAT_COLORS: PlayerColorId[] = ["red", "blue", "green", "yellow", "black"];

export default function RoomLobby() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = decodeURIComponent(rawCode).toUpperCase();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const roomQuery = useQuery({ ...trpc.room.get.queryOptions({ code }), refetchInterval: 1500, meta: { silent: true } });
  const room = roomQuery.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => readJSON("carc.nickname", ""));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (room?.status === "playing" && room.gameId) router.push(`/play/online/${room.gameId}` as Route);
  }, [room?.status, room?.gameId, router]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.room.get.queryKey({ code }) });

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      writeJSON("carc.nickname", nickname);
      await roomApi.join(code, { signedIn: !!session, nickname });
      await refresh();
    } catch (e) {
      setError((e as Error).message || "Couldn’t join");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!room) return;
    setBusy(true);
    try {
      const { gameId } = await roomApi.start(room.id);
      router.push(`/play/online/${gameId}` as Route);
    } catch (e) {
      setError((e as Error).message || "Couldn’t start");
      setBusy(false);
    }
  };

  const [link, setLink] = useState(`/r/${code}`);
  useEffect(() => setLink(`${window.location.origin}/r/${code}`), [code]);
  const seated = !!room && room.mySeat >= 0;
  const max = room?.maxPlayers ?? 4;
  const seats = Array.from({ length: max }, (_, i) => room?.seats[i] ?? null);
  const loadError = roomQuery.error?.message;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8" data-testid="room-lobby" data-room-status={room?.status ?? "loading"}>
      <div className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Room</div>
      <h1 className="font-display text-5xl tracking-[0.12em]" data-testid="room-code">
        {code}
      </h1>

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

      {error || (loadError && !room) ? (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error ?? `${loadError}. This page retries automatically.`}
        </div>
      ) : null}

      <section className="mt-6 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="mb-3 font-display text-2xl">Seats</h2>
        <ol className="grid gap-2 sm:grid-cols-2" data-testid="room-seats">
          {seats.map((s, i) => {
            const color = SEAT_COLORS[i % SEAT_COLORS.length]!;
            const app = PLAYER_COLORS[color];
            return (
              <li key={i} className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/60 p-3" data-seat-kind={s?.kind ?? "open"}>
                <FigureIcon fill={s ? app.fill : "transparent"} outline={s ? undefined : "currentColor"} ink={app.ink} marker={app.marker} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {s ? s.name : "Open seat"}
                    {room && i === room.mySeat ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {s?.kind === "bot" ? <Bot className="size-3" /> : s ? <User className="size-3" /> : null}
                    {s?.kind === "bot" ? `Bot · ${s.tier}` : s ? ("isGuest" in s && s.isGuest ? "guest" : "player") : "waiting…"}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {room && !seated && room.status === "lobby" ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!isPending && !session ? (
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                placeholder={getGuest()?.name ?? "Your nickname"}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                aria-label="Nickname"
              />
            ) : null}
            <button
              type="button"
              onClick={join}
              disabled={busy}
              data-testid="take-seat"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Take a seat
            </button>
          </div>
        ) : null}
        {room?.isHost ? (
          <button
            type="button"
            onClick={start}
            disabled={busy || room.seats.length < 2}
            data-testid="start-online"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Start game
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">The host starts the game when everyone is seated.</p>
        )}
      </section>

      {room ? (
        <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 text-sm shadow-sm">
          <h2 className="mb-2 font-display text-2xl">Rules</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              Field scoring, {["", "1st", "2nd", "3rd"][room.ruleset.fieldEdition]} edition: {EDITION_TEXT[room.ruleset.fieldEdition]}
            </li>
            <li>The River: {room.ruleset.river ? "on" : "off"}</li>
            <li>The Abbot: {room.ruleset.abbot ? "on" : "off"}</li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
