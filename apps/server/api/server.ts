// Vercel Function entrypoint AND local dev server (same code).
//
// vercel.json: service "server" (framework "bun", entrypoint "api/server.ts", `bunVersion` 1.x). Vercel
// detects this module-startup `Bun.serve()` call and routes the service's requests — including WebSocket
// upgrades — through it; `port` only applies locally. `vercel build` emits one `bun1.x` function for it.
// Docs: https://vercel.com/docs/functions/runtimes/bun (Bun.serve entrypoint) and
// https://vercel.com/docs/functions/websockets#bun.
import { getServices } from "../src/bootstrap";
import { createServeOptions } from "../src/main";

const services = getServices();
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  ...createServeOptions(services),
});

if (!process.env.VERCEL) console.log(`Server is running on http://localhost:${server.port} (ws: /ws)`);
