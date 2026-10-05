"use client";

// Every call the web app makes to the server's tRPC routers (packages/api/src/routers)
// lives here, typed by the real AppRouter. Components that want caching/refetching use
// `trpc.*.queryOptions()` from @/utils/trpc directly.

import type { Move } from "@carcassonne/protocol";
import type { PlayerColorId, PlayerMeta } from "@carcassonne/game-client";

import { SERVER_URL, trpcClient, type RouterInputs, type RouterOutputs } from "@/utils/trpc";

import { getGuest, setGuest } from "./guest";

export { SERVER_URL };

// ── rooms ───────────────────────────────────────────────────────────────────

export type Room = RouterOutputs["room"]["get"];
export type RoomSeat = Room["seats"][number];

export const roomApi = {
  /** Host a room (accounts only). */
  create: (input: RouterInputs["room"]["create"]) => trpcClient.room.create.mutate(input),
  get: (code: string) => trpcClient.room.get.query({ code }),
  /** Signed-in users join directly; guests get a signed token for this browser. */
  async join(code: string, opts: { signedIn: boolean; nickname?: string }): Promise<Room> {
    if (opts.signedIn) return trpcClient.room.join.mutate({ code });
    const existing = getGuest();
    if (existing) {
      // Reuse the guest identity (idempotent join) so a reload keeps the seat.
      try {
        return await trpcClient.room.join.mutate({ code });
      } catch {
        /* token expired or room changed: get a fresh one */
      }
    }
    const r = await trpcClient.room.joinAsGuest.mutate({ code, nickname: opts.nickname?.trim() || "Guest" });
    setGuest({ token: r.guestToken, guestId: r.guestId, name: opts.nickname?.trim() || "Guest" });
    return r.room;
  },
  configure: (input: RouterInputs["room"]["configure"]) => trpcClient.room.configure.mutate(input),
  leave: (roomId: string) => trpcClient.room.leave.mutate({ roomId }),
  start: (roomId: string) => trpcClient.room.start.mutate({ roomId }),
};

// ── games ───────────────────────────────────────────────────────────────────

export type OnlineGame = RouterOutputs["game"]["get"];

const COLORS: PlayerColorId[] = ["red", "blue", "green", "yellow", "black", "pink"];

/** Seat metadata for the HUD from `game.get`. */
export function playersOf(g: OnlineGame): PlayerMeta[] {
  return g.players.map((p) => ({
    name: p.name,
    color: (COLORS.includes(p.color as PlayerColorId) ? p.color : COLORS[p.seat % COLORS.length]) as PlayerColorId,
    kind: p.botTier ? "bot" : "remote",
    tier: p.botTier ?? undefined,
    userId: p.userId,
  }));
}

export const gameApi = {
  get: (gameId: string, sincePly?: number) => trpcClient.game.get.query({ gameId, sincePly }),
  /** HTTP intent for polling mode (same validation and compare-and-set as the socket). */
  submitMove: (gameId: string, ply: number, move: Move) => trpcClient.game.submitMove.mutate({ gameId, ply, move }),
  listMine: () => trpcClient.game.listMine.query({ limit: 20 }),
};

// ── matchmaking (ranked 3p/4p FFA) ──────────────────────────────────────────

export const matchmakingApi = {
  join: (queue: "ffa3" | "ffa4") => trpcClient.matchmaking.joinQueue.mutate({ queue }),
  leave: () => trpcClient.matchmaking.leaveQueue.mutate(),
  status: () => trpcClient.matchmaking.status.query(),
};

// ── profile ─────────────────────────────────────────────────────────────────

export type Profile = RouterOutputs["profile"]["get"];

export const profileApi = {
  me: () => trpcClient.profile.get.query({}),
};

// ── realtime endpoints (wire protocol) ──────────────────────────────────────

/** WebSocket URL; guests authenticate with `?guest=<token>` (cookies cover accounts). */
export function gameSocketUrl(): string {
  if (!SERVER_URL) return "";
  const base = `${SERVER_URL.replace(/^http/, "ws")}/ws`;
  const g = getGuest();
  return g ? `${base}?guest=${encodeURIComponent(g.token)}` : base;
}

/** Server transport flag (`FORCE_POLLING` / Edge Config): "websocket" or "polling". */
export async function serverTransport(): Promise<"websocket" | "polling"> {
  try {
    const res = await fetch(`${SERVER_URL}/config`, { cache: "no-store" });
    if (!res.ok) return "websocket";
    const body = (await res.json()) as { transport?: string };
    return body.transport === "polling" ? "polling" : "websocket";
  } catch {
    return "websocket";
  }
}
