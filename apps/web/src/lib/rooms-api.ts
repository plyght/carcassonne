"use client";

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SERVER INTEGRATION POINT. Every call the web app makes to the server's   │
// │ tRPC routers (room, matchmaking, profile, game) lives in this file.      │
// │ Procedure names and shapes are guesses until the server workstream       │
// │ merges; fix them here only. Uses an untyped client so the app compiles   │
// │ before AppRouter has these routers; switch to `trpc.*` once it does.     │
// └──────────────────────────────────────────────────────────────────────────┘

import type { Ruleset } from "@carcassonne/protocol";
import type { AiTier } from "@carcassonne/protocol";
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";

export const SERVER_URL = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/$/, "");

const client = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: `${SERVER_URL}/trpc`,
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
    }),
  ],
});

const query = <T,>(path: string, input?: unknown) => client.query(path, input) as Promise<T>;
const mutate = <T,>(path: string, input?: unknown) => client.mutation(path, input) as Promise<T>;

// ── rooms ───────────────────────────────────────────────────────────────────

export interface RoomSeat {
  seat: number;
  kind: "human" | "bot" | "open";
  name: string | null;
  userId: string | null;
  color: string | null;
  tier?: AiTier;
  connected?: boolean;
}

export interface Room {
  code: string;
  hostUserId: string | null;
  status: "lobby" | "playing" | "ended";
  ruleset: Ruleset;
  seats: RoomSeat[];
  gameId: string | null;
}

export const roomApi = {
  create: (input: { ruleset: Ruleset; seats: number; seed?: string; bots?: { seat: number; tier: AiTier }[] }) =>
    mutate<Room>("room.create", input),
  join: (input: { code: string; nickname?: string }) => mutate<Room>("room.join", input),
  get: (input: { code: string }) => query<Room>("room.get", input),
  start: (input: { code: string }) => mutate<{ gameId: string }>("room.start", input),
};

// ── matchmaking (ranked 3p/4p FFA) ──────────────────────────────────────────

export const matchmakingApi = {
  join: (input: { queue: "ffa3" | "ffa4" }) => mutate<{ ticketId: string }>("matchmaking.join", input),
  leave: () => mutate<void>("matchmaking.leave"),
  status: () => query<{ state: "idle" | "queued" | "matched"; roomCode?: string; queuedAt?: number }>("matchmaking.status"),
};

// ── profile ─────────────────────────────────────────────────────────────────

export interface ProfileStats {
  displayName: string;
  rating: { ffa3: number; ffa4: number } | null;
  games: number;
  wins: number;
  averageScore: number;
}

export const profileApi = {
  me: () => query<ProfileStats>("profile.me"),
};

// ── realtime endpoints (wire protocol) ──────────────────────────────────────

export function gameSocketUrl(): string {
  if (!SERVER_URL) return "";
  return `${SERVER_URL.replace(/^http/, "ws")}/ws`;
}
