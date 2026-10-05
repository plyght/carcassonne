// HTTP routes (Elysia): auth, tRPC, and the CDN-cached polling fallback (PRD §7.3 guard rails).
// Served through src/main.ts, which owns the Bun.serve fetch/websocket entry.
import { getMovesSince } from "@carcassonne/api/game/service";
import { appRouter } from "@carcassonne/api/routers/index";
import { effectiveFlags } from "@carcassonne/api/usage/service";
import { game } from "@carcassonne/db/schema/index";
import { cors } from "@elysiajs/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import { createContext } from "./context";
import type { Services } from "./services";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tiny response shared by every poller of a game for ~1 s at the edge. */
export const PLY_CACHE = "public, max-age=0, s-maxage=1, stale-while-revalidate=1";
/** A committed move never changes. */
export const MOVE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";

function json(body: unknown, status: number, cache: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
  });
}

export function createHttpApp(services: Services) {
  return new Elysia()
    .use(
      cors({
        origin: services.cfg.corsOrigin,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-guest-token"],
        credentials: true,
      }),
    )
    .all("/api/auth/*", async ({ request, status }) => {
      if (["POST", "GET"].includes(request.method)) return services.auth.handler(request);
      return status(405);
    })
    .all("/trpc/*", ({ request }) =>
      fetchRequestHandler({
        endpoint: "/trpc",
        router: appRouter,
        req: request,
        createContext: () => createContext(services, request),
      }),
    )
    // Polling fallback: GET /g/:id/ply every ~2 s, then fetch missing moves from the immutable URLs.
    .get("/g/:id/ply", async ({ params }) => {
      if (!UUID.test(params.id)) return json({ error: "not found" }, 404, "public, s-maxage=60");
      const [g] = await services.db
        .select({ ply: game.ply, status: game.status, deadline: game.turnDeadline })
        .from(game)
        .where(eq(game.id, params.id));
      if (!g) return json({ error: "not found" }, 404, "public, s-maxage=5");
      return json({ ply: g.ply, status: g.status, deadline: g.deadline?.getTime() ?? null }, 200, PLY_CACHE);
    })
    .get("/g/:id/m/:ply", async ({ params }) => {
      const ply = Number(params.ply);
      if (!UUID.test(params.id) || !Number.isInteger(ply) || ply < 0) return json({ error: "not found" }, 404, "public, s-maxage=60");
      const [m] = await getMovesSince(services.db, params.id, ply);
      if (!m || m.ply !== ply) {
        const [g] = await services.db.select({ id: game.id }).from(game).where(and(eq(game.id, params.id)));
        // Not committed yet: cache the miss only briefly.
        return json({ error: g ? "not yet" : "not found" }, 404, "public, max-age=0, s-maxage=1");
      }
      return json({ ply: m.ply, seat: m.seat, move: m.payload, events: m.events, at: m.at.getTime() }, 200, MOVE_CACHE);
    })
    .get("/config", async () => {
      const f = await effectiveFlags(services.deps);
      return json({ transport: f.forcePolling ? "polling" : "websocket", onlinePaused: f.pauseOnline }, 200, "public, max-age=0, s-maxage=10");
    })
    .get("/healthz", () => "OK")
    .get("/", () => "OK");
}
