// The Bun.serve options shared by Vercel and local dev (api/server.ts calls Bun.serve with these).
//
// Why not Elysia's `.ws()` / `export default app`: Vercel's Elysia integration runs a default-exported
// app (`app.listen` is not supported, https://vercel.com/docs/frameworks/backend/elysia), and the only
// documented WebSocket API for the Bun runtime is `Bun.serve({ fetch, websocket })` with
// `server.upgrade()` (https://vercel.com/docs/functions/websockets#bun). So we own `fetch`: `/ws`
// upgrades to a raw Bun WebSocket handled by GameHub; everything else is delegated to Elysia.
import type { Server } from "bun";

import { effectiveFlags } from "@carcassonne/api/usage/service";

import { resolveIdentity } from "./context";
import { createHttpApp } from "./http";
import type { Services } from "./services";
import { createWebSocketHandler, type WsData } from "./ws";

/** When the server is mounted as the `api/server.ts` function, strip that prefix if Vercel passes it. */
const FUNCTION_PREFIX = "/api/server";

export function createServeOptions(services: Services) {
  const app = createHttpApp(services);
  const websocket = createWebSocketHandler(services);

  async function fetch(request: Request, server: Server<WsData>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const prefixed = url.pathname === FUNCTION_PREFIX || url.pathname.startsWith(`${FUNCTION_PREFIX}/`);
    if (prefixed) url.pathname = url.pathname.slice(FUNCTION_PREFIX.length) || "/";
    if (url.pathname === "/ws") {
      // `server.upgrade` needs the original request object, so it is never rebuilt on this path.
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const flags = await effectiveFlags(services.deps);
      if (flags.forcePolling) {
        // New connections go to polling mode (PRD §7.3); clients read this and switch transport.
        return Response.json({ transport: "polling" }, { status: 503, headers: { "retry-after": "60" } });
      }
      const { identity } = await resolveIdentity(services, request.headers, url.searchParams.get("guest"));
      const data: WsData = { connId: crypto.randomUUID(), identity, conn: null };
      if (server.upgrade(request, { data })) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.handle(prefixed ? new Request(url.toString(), request) : request);
  }

  return { fetch, websocket };
}
