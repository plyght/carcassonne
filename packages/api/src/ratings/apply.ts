import type { Tx } from "@carcassonne/db";
import { rating } from "@carcassonne/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";

import { INITIAL, rateFfa, toGlicko1, type Glicko2Rating } from "./glicko2";

export type RankedQueue = "ffa3" | "ffa4";

/** Apply one FFA result to the rating table inside the game-ending transaction. */
export async function applyRankedResult(
  tx: Tx,
  queue: RankedQueue,
  results: { userId: string; score: number }[],
) {
  const ids = results.map((r) => r.userId);
  // Lock in a stable order to avoid deadlocks between concurrently ending games.
  const rows = await tx
    .select()
    .from(rating)
    .where(and(eq(rating.queue, queue), inArray(rating.userId, ids)))
    .orderBy(rating.userId)
    .for("update");
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const before: Glicko2Rating[] = ids.map((id) => {
    const r = byId.get(id);
    return r ? { mu: r.mu, phi: r.phi, sigma: r.sigma } : INITIAL;
  });
  const after = rateFfa(
    before,
    results.map((r) => r.score),
  );
  for (let i = 0; i < ids.length; i++) {
    const a = after[i]!;
    await tx
      .insert(rating)
      .values({ userId: ids[i]!, queue, mu: a.mu, phi: a.phi, sigma: a.sigma, games: 1 })
      .onConflictDoUpdate({
        target: [rating.userId, rating.queue],
        set: { mu: a.mu, phi: a.phi, sigma: a.sigma, games: sql`${rating.games} + 1`, updatedAt: new Date() },
      });
  }
  return ids.map((userId, i) => ({ userId, before: toGlicko1(before[i]!), after: toGlicko1(after[i]!) }));
}
