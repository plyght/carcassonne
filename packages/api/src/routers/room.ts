// Invite rooms (PRD §6.7): created via tRPC, joined by /r/{code}. The host sets ruleset, bots and clock,
// can kick, and starts the game. Guests join with a nickname and get a signed guest token.
import type { Tx } from "@carcassonne/db";
import { room, type RoomSeatJson } from "@carcassonne/db/schema/index";
import { DEFAULT_RULESET } from "@carcassonne/protocol";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createGameTx, runFollowUps } from "../game/service";
import { issueGuestToken, sanitizeNickname, type Identity } from "../identity";
import { identityProcedure, protectedProcedure, publicProcedure, router } from "../index";
import { effectiveFlags } from "../usage/service";
import { botTierSchema, clockSchema, rulesetSchema } from "./schemas";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function roomCode(len = 6) {
  const r = new Uint8Array(len);
  crypto.getRandomValues(r);
  return [...r].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

type RoomRow = typeof room.$inferSelect;

const BOT_NAMES: Record<string, string> = { easy: "Easy Bot", medium: "Medium Bot", hard: "Hard Bot", expert: "Expert Bot" };

const seatMatches = (s: RoomSeatJson, who: Identity) =>
  s.kind === "human" && (who.kind === "user" ? s.userId === who.userId : s.guestId === who.guestId);

const humanSeat = (who: Identity): RoomSeatJson => ({
  kind: "human",
  userId: who.kind === "user" ? who.userId : null,
  guestId: who.kind === "guest" ? who.guestId : null,
  name: who.name,
});

export function publicRoom(r: RoomRow, who: Identity | null) {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    ruleset: r.ruleset,
    clock: r.clock,
    maxPlayers: r.maxPlayers,
    seats: r.seats.map((s) => (s.kind === "bot" ? s : { kind: s.kind, name: s.name, userId: s.userId, isGuest: !!s.guestId })),
    gameId: r.gameId,
    isHost: !!who && r.hostId === hostKey(who),
    mySeat: who ? r.seats.findIndex((s) => seatMatches(s, who)) : -1,
  };
}

const hostKey = (who: Identity) => (who.kind === "user" ? who.userId : who.guestId);

async function lockRoom(tx: Tx, where: { id: string } | { code: string }) {
  const [r] = await tx
    .select()
    .from(room)
    .where("id" in where ? eq(room.id, where.id) : eq(room.code, where.code.toUpperCase()))
    .for("update");
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
  return r;
}

function requireHost(r: RoomRow, who: Identity) {
  if (r.hostId !== hostKey(who)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can do that" });
}

function requireLobby(r: RoomRow) {
  if (r.status !== "lobby") throw new TRPCError({ code: "CONFLICT", message: "Game already started" });
}

async function joinTx(tx: Tx, code: string, who: Identity) {
  const r = await lockRoom(tx, { code });
  if (r.seats.some((s) => seatMatches(s, who))) return r; // idempotent
  requireLobby(r);
  if (r.ranked) throw new TRPCError({ code: "FORBIDDEN", message: "Ranked rooms are matched by the queue" });
  if (r.seats.length >= r.maxPlayers) throw new TRPCError({ code: "CONFLICT", message: "Room is full" });
  const [u] = await tx
    .update(room)
    .set({ seats: [...r.seats, humanSeat(who)] })
    .where(eq(room.id, r.id))
    .returning();
  return u!;
}

export const roomRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        ruleset: rulesetSchema.default(DEFAULT_RULESET),
        clock: clockSchema.default({ type: "none" }),
        maxPlayers: z.number().int().min(2).max(5).default(5),
        bots: z.array(botTierSchema).max(4).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if ((await effectiveFlags(ctx.deps)).pauseOnline) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Online play is paused for this month" });
      }
      if (input.bots.length + 1 > input.maxPlayers) throw new TRPCError({ code: "BAD_REQUEST", message: "Too many bots" });
      const seats: RoomSeatJson[] = [
        humanSeat(ctx.identity),
        ...input.bots.map((tier) => ({ kind: "bot" as const, tier, name: BOT_NAMES[tier]! })),
      ];
      for (let attempt = 0; attempt < 5; attempt++) {
        const [r] = await ctx.db
          .insert(room)
          .values({ code: roomCode(), hostId: ctx.identity.userId, ruleset: input.ruleset, clock: input.clock, maxPlayers: input.maxPlayers, seats })
          .onConflictDoNothing()
          .returning();
        if (r) return publicRoom(r, ctx.identity);
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not allocate a room code" });
    }),

  get: publicProcedure.input(z.object({ code: z.string().min(4).max(12) })).query(async ({ ctx, input }) => {
    const [r] = await ctx.db.select().from(room).where(eq(room.code, input.code.toUpperCase()));
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
    return publicRoom(r, ctx.identity);
  }),

  join: identityProcedure.input(z.object({ code: z.string().min(4).max(12) })).mutation(async ({ ctx, input }) => {
    const r = await ctx.db.transaction((tx) => joinTx(tx, input.code, ctx.identity));
    return publicRoom(r, ctx.identity);
  }),

  /** Guest join: returns a signed guest token to send as `x-guest-token` (and `?guest=` on /ws). */
  joinAsGuest: publicProcedure
    .input(z.object({ code: z.string().min(4).max(12), nickname: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const { token, guestId } = issueGuestToken(ctx.deps.guestSecret, sanitizeNickname(input.nickname));
      const who: Identity = { kind: "guest", guestId, name: sanitizeNickname(input.nickname) };
      const r = await ctx.db.transaction((tx) => joinTx(tx, input.code, who));
      return { guestToken: token, guestId, room: publicRoom(r, who) };
    }),

  leave: identityProcedure.input(z.object({ roomId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    return ctx.db.transaction(async (tx) => {
      const r = await lockRoom(tx, { id: input.roomId });
      requireLobby(r);
      const seats = r.seats.filter((s) => !seatMatches(s, ctx.identity));
      let hostId = r.hostId;
      let status = r.status;
      if (hostId === hostKey(ctx.identity)) {
        const nextHost = seats.find((s) => s.kind === "human");
        if (nextHost && nextHost.kind === "human") hostId = (nextHost.userId ?? nextHost.guestId)!;
        else status = "closed";
      }
      const [u] = await tx.update(room).set({ seats, hostId, status }).where(eq(room.id, r.id)).returning();
      return publicRoom(u!, ctx.identity);
    });
  }),

  kick: identityProcedure
    .input(z.object({ roomId: z.string().uuid(), seat: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const r = await lockRoom(tx, { id: input.roomId });
        requireHost(r, ctx.identity);
        requireLobby(r);
        const target = r.seats[input.seat];
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "No such seat" });
        if (seatMatches(target, ctx.identity)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use leave" });
        const seats = r.seats.filter((_, i) => i !== input.seat);
        const [u] = await tx.update(room).set({ seats }).where(eq(room.id, r.id)).returning();
        return publicRoom(u!, ctx.identity);
      });
    }),

  /** Host-only lobby settings: ruleset, clock, bots (replaces all bot seats). */
  configure: identityProcedure
    .input(
      z.object({
        roomId: z.string().uuid(),
        ruleset: rulesetSchema.optional(),
        clock: clockSchema.optional(),
        maxPlayers: z.number().int().min(2).max(5).optional(),
        bots: z.array(botTierSchema).max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const r = await lockRoom(tx, { id: input.roomId });
        requireHost(r, ctx.identity);
        requireLobby(r);
        let seats = r.seats;
        if (input.bots) {
          seats = [
            ...r.seats.filter((s) => s.kind === "human"),
            ...input.bots.map((tier) => ({ kind: "bot" as const, tier, name: BOT_NAMES[tier]! })),
          ];
        }
        const maxPlayers = input.maxPlayers ?? r.maxPlayers;
        if (seats.length > maxPlayers) throw new TRPCError({ code: "BAD_REQUEST", message: "Too many seats" });
        const [u] = await tx
          .update(room)
          .set({ seats, maxPlayers, ruleset: input.ruleset ?? r.ruleset, clock: input.clock ?? r.clock })
          .where(eq(room.id, r.id))
          .returning();
        return publicRoom(u!, ctx.identity);
      });
    }),

  start: identityProcedure.input(z.object({ roomId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const res = await ctx.db.transaction(async (tx) => {
      const r = await lockRoom(tx, { id: input.roomId });
      requireHost(r, ctx.identity);
      requireLobby(r);
      if (r.seats.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Need at least 2 players" });
      const { gameId, jobs } = await createGameTx(tx, ctx.deps, {
        roomId: r.id,
        ruleset: r.ruleset,
        clock: r.clock,
        seats: r.seats,
      });
      await tx.update(room).set({ status: "playing", gameId }).where(eq(room.id, r.id));
      return { gameId, jobs };
    });
    await runFollowUps(ctx.deps, res.jobs);
    return { gameId: res.gameId };
  }),
});

