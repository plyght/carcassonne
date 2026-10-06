// Serves the playground with Bun's HTML bundler: `bun playground/serve.ts [port]`.
import { resolve } from "node:path";
import page from "./index.html";

const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const wasm = resolve(import.meta.dir, "../../core-wasm/core.wasm");
const reference = resolve(import.meta.dir, "../../../docs/design/inspiration/tabletop-diorama-01.webp");

const server = Bun.serve({
  port,
  development: process.env.NODE_ENV !== "production" ? { hmr: false } : false,
  routes: {
    "/": page,
    "/core.wasm": () => new Response(Bun.file(wasm), { headers: { "content-type": "application/wasm", "cache-control": "no-store" } }),
    "/reference.webp": () => new Response(Bun.file(reference)),
  },
});
console.log(`render-three playground: ${server.url}`);
