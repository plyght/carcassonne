import { game, gamePlayer, profile, rating, user } from "@carcassonne/db/schema/index";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";
import { toGlicko1 } from "../ratings/glicko2";

async function stats(ctx: Pick<Context, "db">, userId: string) {
  const [s] = await ctx.db
    .select({
      games: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${gamePlayer.placement} = 1)::int`,
      avgScore: sql<number>`coalesce(avg(${gamePlayer.finalScore}), 0)::float8`,
      road: sql<number>`coalesce(sum((${gamePlayer.breakdown}->>'road')::int), 0)::int`,
      city: sql<number>`coalesce(sum((${gamePlayer.breakdown}->>'city')::int), 0)::int`,
      cloister: sql<number>`coalesce(sum((${gamePlayer.breakdown}->>'cloister')::int), 0)::int`,
      garden: sql<number>`coalesce(sum((${gamePlayer.breakdown}->>'garden')::int), 0)::int`,
      field: sql<number>`coalesce(sum((${gamePlayer.breakdown}->>'field')::int), 0)::int`,
    })
    .from(gamePlayer)
    .innerJoin(game, eq(game.id, gamePlayer.gameId))
    .where(and(eq(gamePlayer.userId, userId), eq(game.status, "ended")));
  return {
    games: s?.games ?? 0,
    wins: s?.wins ?? 0,
    averageScore: s?.avgScore ?? 0,
    pointsByFeature: {
      road: s?.road ?? 0,
      city: s?.city ?? 0,
      cloister: s?.cloister ?? 0,
      garden: s?.garden ?? 0,
      field: s?.field ?? 0,
    },
  };
}

async function ratingsOf(ctx: Pick<Context, "db">, userId: string) {
  const rows = await ctx.db.select().from(rating).where(eq(rating.userId, userId));
  return rows.map((r) => ({ queue: r.queue, games: r.games, ...toGlicko1(r) }));
}

export const profileRouter = router({
  get: publicProcedure.input(z.object({ userId: z.string().optional() }).default({})).query(async ({ ctx, input }) => {
    const userId = input.userId ?? (ctx.identity?.kind === "user" ? ctx.identity.userId : null);
    if (!userId) throw new TRPCError({ code: "BAD_REQUEST", message: "userId required" });
    const [u] = await ctx.db
      .select({ id: user.id, name: user.name, image: user.image, p: profile })
      .from(user)
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(eq(user.id, userId));
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    const recent = await ctx.db
      .select({ gameId: game.id, status: game.status, ranked: game.ranked, startedAt: game.startedAt, finalScore: gamePlayer.finalScore, placement: gamePlayer.placement })
      .from(gamePlayer)
      .innerJoin(game, eq(game.id, gamePlayer.gameId))
      .where(eq(gamePlayer.userId, userId))
      .orderBy(desc(game.startedAt))
      .limit(10);
    return {
      userId: u.id,
      displayName: u.p?.displayName ?? u.name,
      avatar: u.p?.avatar ?? u.image,
      colorPref: u.p?.colorPref ?? null,
      stats: await stats(ctx, userId),
      ratings: await ratingsOf(ctx, userId),
      recentGames: recent.map((r) => ({ ...r, startedAt: r.startedAt.getTime() })),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(32).optional(),
        avatar: z.string().url().max(512).nullable().optional(),
        colorPref: z.enum(["red", "blue", "green", "yellow", "black"]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.identity.userId;
      const [row] = await ctx.db
        .insert(profile)
        .values({
          userId,
          displayName: input.displayName ?? ctx.identity.name,
          avatar: input.avatar ?? null,
          colorPref: input.colorPref ?? null,
        })
        .onConflictDoUpdate({
          target: profile.userId,
          set: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
            ...(input.colorPref !== undefined ? { colorPref: input.colorPref } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row!;
    }),

  stats: publicProcedure.input(z.object({ userId: z.string() })).query(({ ctx, input }) => stats(ctx, input.userId)),
});

export const ratingsRouter = router({
  get: publicProcedure.input(z.object({ userId: z.string() })).query(({ ctx, input }) => ratingsOf(ctx, input.userId)),
  leaderboard: publicProcedure
    .input(z.object({ queue: z.enum(["ffa3", "ffa4"]), limit: z.number().int().min(1).max(100).default(25) }))
    .query(async ({ ctx, input }) => {
      // Conservative rating (mu - 2·phi) so provisional players don't top the board.
      const rows = await ctx.db
        .select({ userId: rating.userId, mu: rating.mu, phi: rating.phi, sigma: rating.sigma, games: rating.games, name: user.name, displayName: profile.displayName })
        .from(rating)
        .innerJoin(user, eq(user.id, rating.userId))
        .leftJoin(profile, eq(profile.userId, rating.userId))
        .where(eq(rating.queue, input.queue))
        .orderBy(desc(sql`${rating.mu} - 2 * ${rating.phi}`))
        .limit(input.limit);
      return rows.map((r) => ({ userId: r.userId, name: r.displayName ?? r.name, games: r.games, ...toGlicko1(r) }));
    }),
});
