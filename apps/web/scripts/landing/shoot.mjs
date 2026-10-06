// Offline renders for the landing page (headless Chromium, WebGL2 on SwiftShader: slow,
// so every image is one deliberate frame on a manual clock).
//   bun scripts/landing/shoot.mjs gen [seed]                  # record the hero game (Medium bots)
//   bun scripts/landing/shoot.mjs shot out.png "ply=34&shot=wide&bg=%23f3eadb" 2400 1400
//   bun scripts/landing/shoot.mjs classic out.png "ply=50" 1600 1000  # the same game on the 2D Classic board
//   bun scripts/landing/shoot.mjs tiles outdir "E:0,D:0" 384  # painted Classic tiles, one PNG each (+ anchors.json)
// Chromium comes from /opt/pw-browsers (CHROMIUM to override). Encode to WebP afterwards.
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const gameFile = resolve(web, "src/components/landing/hero-game.json");
const wasm = resolve(web, "../../packages/core-wasm/core.wasm");

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const p = `${root}/${d}/chrome-linux/chrome`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function bundle(entry) {
  const built = await Bun.build({ entrypoints: [resolve(here, entry)], target: "browser", minify: true });
  if (!built.success) throw new Error(built.logs.join("\n"));
  return built.outputs[0].text();
}

const mode = process.argv[2];
const landing =
  mode === "gen"
    ? { seed: process.argv[3] ?? "3", players: 4, moves: [] }
    : JSON.parse(readFileSync(gameFile, "utf8"));
const js = await bundle(mode === "tiles" || mode === "classic" ? "tiles-entry.tsx" : "poster-entry.ts");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
#board{position:fixed;inset:0;width:100vw;height:100vh;display:block}
</style></head><body><canvas id="board"></canvas>
<script>window.LANDING=${JSON.stringify(landing)};</script>
<script type="module" src="/entry.js"></script></body></html>`;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/entry.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
    if (u.pathname === "/core.wasm") return new Response(Bun.file(wasm), { headers: { "content-type": "application/wasm" } });
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});

async function open(query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console.error:", m.text().slice(0, 400)));
  await page.goto(`${server.url}?${query}`);
  await page.waitForFunction(() => window.__poster?.ready, null, { timeout: Number(process.env.SHOT_TIMEOUT ?? 600000) });
  const err = await page.evaluate(() => window.__poster.error);
  if (err) throw new Error(err);
  return page;
}

try {
  if (mode === "gen") {
    const page = await open("gen=1", 200, 200);
    const moves = await page.evaluate(() => window.__poster.moves);
    writeFileSync(gameFile, JSON.stringify({ seed: landing.seed, players: landing.players, moves }) + "\n");
    console.log(`recorded ${moves.length} plies (seed ${landing.seed}) -> ${gameFile}`);
  } else if (mode === "shot" || mode === "classic") {
    const [out, query, w = "1600", h = "1000"] = process.argv.slice(3);
    const page = await open(mode === "classic" ? `mode=classic&${query}` : query, Number(w), Number(h));
    await page.screenshot({ path: resolve(out), omitBackground: false });
    console.log(out);
  } else if (mode === "tiles") {
    const [outDir, list, size = "384"] = process.argv.slice(3);
    const page = await open(`size=${size}&tiles=${list}`, 400, 400);
    const { tiles, anchors } = await page.evaluate(() => window.__poster);
    writeFileSync(resolve(outDir, "anchors.json"), JSON.stringify(anchors, null, 1));
    for (const [name, url] of Object.entries(tiles)) {
      writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    console.log(`${Object.keys(tiles).length} tiles -> ${outDir}`);
  } else {
    console.log("usage: gen | shot | tiles");
  }
} finally {
  await browser.close();
  server.stop(true);
}
