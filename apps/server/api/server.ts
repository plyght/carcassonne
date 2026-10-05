// Vercel Function entrypoint AND local dev server (same code).
//
// Vercel (Bun runtime, `bunVersion` in vercel.json) detects this module-startup `Bun.serve()` call and
// routes the function's requests — including WebSocket upgrades — through it; `port` only applies
// locally. Docs: https://vercel.com/docs/functions/runtimes/bun#deploy-a-bun-server-from-api and
// https://vercel.com/docs/functions/websockets#bun.
import { getServices } from "../src/bootstrap";
import { createServeOptions } from "../src/main";

const services = getServices();
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  ...createServeOptions(services),
});

if (!process.env.VERCEL) console.log(`Server is running on http://localhost:${server.port} (ws: /ws)`);
