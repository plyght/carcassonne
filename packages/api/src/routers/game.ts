import { game, gamePlayer } from "@carcassonne/db/schema/index";
import type { EngineEvent, Move } from "@carcassonne/protocol";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { getMovesSince, getView, replayLoaded, seatOf, submitMove } from "../game/service";
import { identityProcedure, publicProcedure, router } from "../index";
import { moveSchema } from "./schemas";

export const gameRouter = router({
  /** Current view plus the events since `sincePly` (reconnect / polling catch-up). */
  get: publicProcedure
    .input(z.object({ gameId: z.string().uuid(), sincePly: z.number().int().min(0).optional() }))
    .query(async ({ ctx, input }) => {
      const res = await getView(ctx.deps, input.gameId);
      if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      const { loaded, view } = res;
      const since =
        input.sincePly !== undefined && input.sincePly < view.ply
          ? await getMovesSince(ctx.db, input.gameId, input.sincePly)
          : [];
      return {
        gameId: input.gameId,
        view,
        ply: view.ply,
        seat: ctx.identity ? seatOf(loaded.players, ctx.identity) : null,
        status: loaded.game.status,
        ranked: loaded.game.ranked,
        clock: loaded.game.clock,
        deadline: loaded.game.turnDeadline?.getTime() ?? null,
        players: loaded.players.map((p) => ({
          seat: p.seat,
          name: p.name,
          userId: p.userId,
          botTier: p.botTier,
          color: p.color,
          afk: p.afk,
          finalScore: p.finalScore,
          placement: p.placement,
        })),
        events: since.flatMap((m) => m.events as EngineEvent[]),
      };
    }),

  /** Legal placements for the tile in hand (clients have no deck, so the server answers). */
  legal: publicProcedure.input(z.object({ gameId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const res = await getView(ctx.deps, input.gameId);
    if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
    const eg = await replayLoaded(ctx.deps, res.loaded);
    try {
      return { ply: res.view.ply, placements: eg.legalPlacements() };
    } finally {
      eg.free();
    }
  }),

  /** Intent over HTTP (polling mode). Same validation and compare-and-set as the WebSocket path. */
  submitMove: identityProcedure
    .input(z.object({ gameId: z.string().uuid(), ply: z.number().int().min(0), move: moveSchema }))
    .mutation(async ({ ctx, input }) => {
      const r = await submitMove(ctx.deps, { gameId: input.gameId, ply: input.ply, move: input.move as Move, actor: ctx.identity });
      if (!r.ok) throw new TRPCError({ code: r.code === "not_found" ? "NOT_FOUND" : "CONFLICT", message: r.error, cause: r.code });
      return { ply: r.ply, events: r.events };
    }),

  /** Replay data (PRD §6.9): (engineVersion, ruleset, seed, moves[]). Only for finished games — the seed fixes the deck order. */
  replay: publicProcedure.input(z.object({ gameId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [g] = await ctx.db.select().from(game).where(eq(game.id, input.gameId));
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
    if (g.status === "playing") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Game still in progress" });
    const [players, moves] = await Promise.all([
      ctx.db.select().from(gamePlayer).where(eq(gamePlayer.gameId, g.id)).orderBy(gamePlayer.seat),
      getMovesSince(ctx.db, g.id, 0),
    ]);
    return {
      gameId: g.id,
      engineVersion: g.engineVersion,
      seed: g.seed,
      ruleset: g.ruleset,
      players: players.map((p) => ({ seat: p.seat, name: p.name, userId: p.userId, botTier: p.botTier, color: p.color, finalScore: p.finalScore, breakdown: p.breakdown })),
      moves: moves.map((m) => ({ ply: m.ply, seat: m.seat, move: m.payload as Move, at: m.at.getTime() })),
      startedAt: g.startedAt.getTime(),
      endedAt: g.endedAt?.getTime() ?? null,
    };
  }),

  /** My games, newest first (cursor = startedAt ms of the last item). */
  listMine: identityProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.number().optional() }).default({ limit: 20 }))
    .query(async ({ ctx, input }) => {
      const who = ctx.identity;
      const mine = ctx.db
        .select({ gameId: gamePlayer.gameId })
        .from(gamePlayer)
        .where(who.kind === "user" ? eq(gamePlayer.userId, who.userId) : eq(gamePlayer.guestId, who.guestId));
      const rows = await ctx.db
        .select()
        .from(game)
        .where(
          and(
            inArray(game.id, mine),
            input.cursor !== undefined ? lt(game.startedAt, new Date(input.cursor)) : undefined,
          ),
        )
        .orderBy(desc(game.startedAt))
        .limit(input.limit);
      const players = rows.length
        ? await ctx.db.select().from(gamePlayer).where(inArray(gamePlayer.gameId, rows.map((r) => r.id)))
        : [];
      const items = rows.map((g) => ({
        gameId: g.id,
        status: g.status,
        ranked: g.ranked,
        queue: g.queue,
        ply: g.ply,
        startedAt: g.startedAt.getTime(),
        endedAt: g.endedAt?.getTime() ?? null,
        players: players
          .filter((p) => p.gameId === g.id)
          .sort((a, b) => a.seat - b.seat)
          .map((p) => ({ seat: p.seat, name: p.name, userId: p.userId, botTier: p.botTier, finalScore: p.finalScore, placement: p.placement })),
      }));
      return { items, nextCursor: items.length === input.limit ? items[items.length - 1]!.startedAt : null };
    }),
});
