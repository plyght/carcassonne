// Screenshots of the real ClassicBoard with painted tiles on engine-played boards:
// mid game, a late game with a big multi-tile city, and a River game.
//   bun scripts/board-shots.ts [outDir] [--only mid,late,river,zoom,blueprint]
import { DEFAULT_RULESET, type BoardTile, type Ruleset } from "@carcassonne/protocol";
import { analyzeBoard, boardFromTiles } from "@carcassonne/game-client";
import { catalogFromKit, loadEngine } from "@carcassonne/game-client/engine";
import { seedFromString } from "@carcassonne/game-client/engine-port";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--only")) ?? new URL("../../../docs/screenshots", import.meta.url).pathname;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]!.split(",") : null;

const port = await loadEngine();
const catalog = catalogFromKit(port.kit);

function play(seed: string, rules: Ruleset, plies: number): BoardTile[] {
  const h = port.createGame(rules, seedFromString(seed), 3);
  let view = port.view(h);
  for (let i = 0; i < plies && view.status === "playing"; i++) {
    const move = port.aiChoose(h, "medium", 5, BigInt(i + 1));
    if (!port.apply(h, move).ok) break;
    view = port.view(h);
  }
  return view.board;
}

function biggestCity(board: BoardTile[]): number {
  const a = analyzeBoard(boardFromTiles(board), catalog);
  let best = 0;
  for (const t of board) {
    const def = catalog.get(t.tile)!;
    def.features.forEach((f, i) => {
      if (f.kind === "city") best = Math.max(best, a.extentOf(t.x, t.y, i)?.cells.length ?? 0);
    });
  }
  return best;
}

const NO_RIVER: Ruleset = { ...DEFAULT_RULESET, river: false };
type Shot = { name: string; board: BoardTile[]; zoom?: number; focus?: [number, number]; blueprint?: boolean; w?: number; h?: number };
const shots: Shot[] = [];
const want = (n: string) => !only || only.includes(n);

if (want("mid")) shots.push({ name: "classic-illustrated-mid", board: play("illustrated-mid", NO_RIVER, 30) });
if (want("late") || want("zoom")) {
  let best: BoardTile[] = [];
  let size = -1;
  for (const s of ["late-1", "late-2", "late-3", "late-4", "late-5", "late-6"]) {
    const b = play(s, NO_RIVER, 200);
    const c = biggestCity(b);
    if (c > size) {
      size = c;
      best = b;
    }
  }
  console.log("late game:", best.length, "tiles; biggest city", size, "tiles");
  if (want("late")) shots.push({ name: "classic-illustrated-late", board: best });
  if (want("zoom")) shots.push({ name: "classic-illustrated-zoom", board: best, zoom: 3.2 });
}
if (want("river")) shots.push({ name: "classic-illustrated-river", board: play("illustrated-river", DEFAULT_RULESET, 22) });
if (want("blueprint")) shots.push({ name: "blueprint-check", board: play("illustrated-mid", NO_RIVER, 30), blueprint: true });

const built = await Bun.build({
  entrypoints: [new URL("./board-entry.tsx", import.meta.url).pathname],
  target: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!built.success) throw new Error(built.logs.join("\n"));
const js = await built.outputs[0]!.text();
const wasm = Bun.file(new URL("../../core-wasm/core.wasm", import.meta.url).pathname);

let current: Shot = shots[0]!;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/core.wasm") return new Response(wasm, { headers: { "content-type": "application/wasm" } });
    if (url.pathname === "/entry.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div>
<script>window.HARNESS=${JSON.stringify({ board: current.board, zoom: current.zoom, focus: current.focus, blueprint: current.blueprint })}</script>
<script type="module" src="/entry.js"></script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const shot of shots) {
  current = shot;
  const page = await browser.newPage({ viewport: { width: shot.w ?? 1440, height: shot.h ?? 900 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`http://localhost:${server.port}/`);
  // Wait until every tile is a painted bitmap (or vector for Blueprint) and the queue is idle.
  await page
    .waitForFunction((n) => document.querySelectorAll("svg.cc-board image").length >= n, shot.blueprint ? 0 : shot.board.length, { timeout: 30_000 })
    .catch(() => console.log("timeout waiting for painted tiles", logs.join("\n")));
  await page.waitForTimeout(700);
  const stats = await page.evaluate(() => (window as unknown as { STATS: { painted: number; paintMs: number } }).STATS);
  // Pan smoothness: time 60 synthetic pans.
  const pan = await page.evaluate(async () => {
    const svg = document.querySelector("svg.cc-board")!;
    const r = svg.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, button: 0, pointerType: "mouse" }));
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    fire("pointerdown", cx, cy);
    const frames: number[] = [];
    let last = performance.now();
    for (let i = 1; i <= 60; i++) {
      fire("pointermove", cx + i * 2, cy + i);
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    for (let i = 59; i >= 0; i--) {
      fire("pointermove", cx + i * 2, cy + i);
      await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", cx, cy);
    frames.sort((a, b) => a - b);
    return { median: frames[30], p95: frames[57] };
  });
  await page.waitForTimeout(300);
  const out = `${outDir}/${shot.name}.png`;
  await page.screenshot({ path: out });
  console.log(
    `${shot.name}: ${shot.board.length} tiles, ready in ${Date.now() - t0} ms; painted ${stats.painted} bitmaps in ${stats.paintMs.toFixed(0)} ms; pan frame median ${pan.median?.toFixed(1)} ms p95 ${pan.p95?.toFixed(1)} ms -> ${out}`,
  );
  if (logs.some((l) => l.startsWith("pageerror"))) console.log(logs.join("\n"));
  await page.close();
}
await browser.close();
server.stop();
