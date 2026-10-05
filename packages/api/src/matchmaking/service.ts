// Ranked 3p/4p FFA matchmaking (PRD §6.7, §7.3). Each joinQueue tries to form a match in one transaction
// with `SELECT … FOR UPDATE SKIP LOCKED`; if none forms, a delayed Vercel Queues retry runs after 15 s.
import { profile, queueTicket, rating, user, type ClockJson, type RoomSeatJson } from "@carcassonne/db/schema/index";
import { DEFAULT_RULESET } from "@carcassonne/protocol";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Deps } from "../deps";
import { createGameTx, notify, runFollowUps, userChannel } from "../game/service";
import { SCALE } from "../ratings/glicko2";
import type { Job } from "../scheduler/types";

export type RankedQueue = "ffa3" | "ffa4";
export const QUEUE_SIZE: Record<RankedQueue, number> = { ffa3: 3, ffa4: 4 };
/** Ranked uses a fixed ruleset and clock per queue (PRD §6.1, §6.6). */
export const RANKED_RULESET = DEFAULT_RULESET;
export const RANKED_CLOCK: ClockJson = { type: "turn", turnSeconds: 45 };
export const RETRY_SECONDS = 15;

/** Rating window (display points) grows with the oldest ticket's wait. */
export const ratingWindow = (waitMs: number) => Math.min(1000, 150 + (waitMs / 1000) * 10);

export async function displayRating(deps: Pick<Deps, "db">, userId: string, queue: RankedQueue) {
  const [r] = await deps.db
    .select()
    .from(rating)
    .where(and(eq(rating.userId, userId), eq(rating.queue, queue)));
  return 1500 + SCALE * (r?.mu ?? 0);
}

export async function joinQueue(deps: Deps, userId: string, queue: RankedQueue) {
  const r = await displayRating(deps, userId, queue);
  await deps.db.insert(queueTicket).values({ userId, queue, rating: r }).onConflictDoNothing();
  await tryMatch(deps, queue);
  await retryIfWaiting(deps, queue);
  return queueStatus(deps, userId);
}

export async function leaveQueue(deps: Pick<Deps, "db">, userId: string) {
  await deps.db
    .update(queueTicket)
    .set({ status: "cancelled" })
    .where(and(eq(queueTicket.userId, userId), eq(queueTicket.status, "waiting")));
}

export async function queueStatus(deps: Pick<Deps, "db">, userId: string) {
  const [t] = await deps.db
    .select()
    .from(queueTicket)
    .where(eq(queueTicket.userId, userId))
    .orderBy(desc(queueTicket.createdAt))
    .limit(1);
  if (!t || t.status === "cancelled") return { status: "idle" as const };
  return {
    status: t.status,
    queue: t.queue,
    gameId: t.gameId,
    waitingSince: t.createdAt.getTime(),
  };
}

/** Enqueue a retry while tickets are waiting. Keyed per 15 s window so concurrent joins share one. */
export async function retryIfWaiting(deps: Deps, queue: RankedQueue) {
  const [w] = await deps.db
    .select({ id: queueTicket.id })
    .from(queueTicket)
    .where(and(eq(queueTicket.queue, queue), eq(queueTicket.status, "waiting")))
    .limit(1);
  if (!w) return false;
  const slot = Math.floor(deps.now() / (RETRY_SECONDS * 1000));
  await deps.scheduler.enqueue(
    "matchmaking-retry",
    { queue },
    { delaySeconds: RETRY_SECONDS, idempotencyKey: `mm:${queue}:${slot}` },
  );
  return true;
}

function shuffle<T>(a: T[]): T[] {
  const r = new Uint32Array(a.length);
  crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Try to form one match. Returns the new game id, or null. */
export async function tryMatch(deps: Deps, queue: RankedQueue): Promise<string | null> {
  const n = QUEUE_SIZE[queue];
  const nowMs = deps.now();
  const res = await deps.db.transaction(async (tx) => {
    const tickets = await tx
      .select()
      .from(queueTicket)
      .where(and(eq(queueTicket.queue, queue), eq(queueTicket.status, "waiting")))
      .orderBy(asc(queueTicket.createdAt))
      .limit(50)
      .for("update", { skipLocked: true });
    if (tickets.length < n) return null;

    let group: typeof tickets | null = null;
    for (const anchor of tickets) {
      const win = ratingWindow(nowMs - anchor.createdAt.getTime());
      const near = tickets
        .filter((t) => t.id !== anchor.id && Math.abs(t.rating - anchor.rating) <= win)
        .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
      if (near.length >= n - 1) {
        group = [anchor, ...near.slice(0, n - 1)];
        break;
      }
    }
    if (!group) return null;

    const ids = group.map((t) => t.userId);
    const names = await tx
      .select({ id: user.id, name: user.name, displayName: profile.displayName })
      .from(user)
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(inArray(user.id, ids));
    const nameOf = new Map(names.map((u) => [u.id, u.displayName ?? u.name]));
    // Server-picked seat order.
    const seats: RoomSeatJson[] = shuffle([...ids]).map((id) => ({
      kind: "human",
      userId: id,
      guestId: null,
      name: nameOf.get(id) ?? "Player",
    }));
    const { gameId, jobs } = await createGameTx(tx, deps, {
      ruleset: RANKED_RULESET,
      clock: RANKED_CLOCK,
      seats,
      ranked: true,
      queue,
    });
    await tx
      .update(queueTicket)
      .set({ status: "matched", gameId })
      .where(inArray(
        queueTicket.id,
        group.map((t) => t.id),
      ));
    for (const id of ids) await notify(tx, userChannel(id), { k: "matched", gameId, queue });
    return { gameId, jobs: jobs as Job[] };
  });
  if (!res) return null;
  await runFollowUps(deps, res.jobs);
  return res.gameId;
}
