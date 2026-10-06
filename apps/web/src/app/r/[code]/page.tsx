"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Copy, Loader2, Play, User } from "lucide-react";

import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";
import type { PlayerColorId } from "@carcassonne/game-client";

import { SeatSwatch } from "@/components/game/hud-parts";
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
    <div className="carc-page" data-testid="room-lobby" data-room-status={room?.status ?? "loading"}>
      <div className="carc-eyebrow">Room</div>
      <h1 className="carc-room-code" data-testid="room-code">
        {code}
      </h1>

      <div className="carc-sheet carc-invite">
        <span className="carc-invite-link" suppressHydrationWarning>
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
          className="carc-btn"
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>

      {error || (loadError && !room) ? (
        <p className="carc-notice mt-[var(--sp-4)]" data-tone="danger" role="alert">
          {error ?? `${loadError}. This page retries automatically.`}
        </p>
      ) : null}

      <section className="carc-sheet mt-[var(--sp-6)]">
        <div className="carc-section-head">
          <h2 className="carc-heading">Seats</h2>
          <span className="carc-sub carc-num mt-0!">
            {room?.seats.length ?? 0} of {max} taken
          </span>
        </div>
        <ol className="carc-seat-grid mt-[var(--sp-4)]" data-testid="room-seats">
          {seats.map((s, i) => {
            const color = SEAT_COLORS[i % SEAT_COLORS.length]!;
            const app = PLAYER_COLORS[color];
            return (
              <li key={i} className="carc-seat-card" data-seat-kind={s?.kind ?? "open"}>
                {s ? (
                  <SeatSwatch color={color} size={36} />
                ) : (
                  <span className="carc-swatch carc-swatch-open" style={{ width: 36, height: 36 }} aria-hidden>
                    <FigureIcon fill="currentColor" ink="transparent" outline="none" marker={app.marker} size={22} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="carc-seat-name-line">
                    <span className="truncate">{s ? s.name : "Open seat"}</span>
                    {room && i === room.mySeat ? <span className="carc-tag" data-tone="accent" data-testid="my-seat">You</span> : null}
                  </div>
                  <div className="carc-seat-meta">
                    {s?.kind === "bot" ? <Bot aria-hidden /> : s ? <User aria-hidden /> : null}
                    {s?.kind === "bot" ? `Bot · ${s.tier}` : s ? ("isGuest" in s && s.isGuest ? "Guest" : "Player") : "Waiting for a player…"}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {room && !seated && room.status === "lobby" ? (
          <div className="mt-[var(--sp-6)] flex flex-wrap items-center gap-[var(--sp-2)]">
            {!isPending && !session ? (
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                placeholder={getGuest()?.name ?? "Your nickname"}
                className="carc-field max-w-64 flex-1"
                aria-label="Nickname"
              />
            ) : null}
            <button type="button" onClick={join} disabled={busy} data-testid="take-seat" className="carc-btn" data-variant="primary">
              Take a seat
            </button>
          </div>
        ) : null}
        {room?.isHost ? (
          <div className="mt-[var(--sp-6)] flex flex-wrap items-center justify-between gap-[var(--sp-3)]">
            <p className="carc-hint">{room.seats.length < 2 ? "Waiting for at least one more player." : "When everyone is seated, deal the first tile."}</p>
            <button
              type="button"
              onClick={start}
              disabled={busy || room.seats.length < 2}
              data-testid="start-online"
              className="carc-btn"
              data-variant="primary"
              data-size="large"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} Start game
            </button>
          </div>
        ) : (
          <p className="carc-hint mt-[var(--sp-4)]">The host starts the game when everyone is seated.</p>
        )}
      </section>

      {room ? (
        <section className="carc-sheet mt-[var(--sp-6)]">
          <h2 className="carc-heading">Rules</h2>
          <dl className="carc-rules-list">
            <dt>Field scoring</dt>
            <dd>
              {["", "1st", "2nd", "3rd"][room.ruleset.fieldEdition]} edition: {EDITION_TEXT[room.ruleset.fieldEdition]}
            </dd>
            <dt>The River</dt>
            <dd>{room.ruleset.river ? "On" : "Off"}</dd>
            <dt>The Abbot</dt>
            <dd>{room.ruleset.abbot ? "On" : "Off"}</dd>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
