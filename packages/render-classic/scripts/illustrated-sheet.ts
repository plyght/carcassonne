// Contact sheet of the painted Classic tiles (every engine tile: A–X, garden variants,
// R1–R12), rendered in Playwright's Chromium.
//   bun scripts/illustrated-sheet.ts [out.png] [--size 256] [--rots] [--only A,B,C] [--cols 8]
import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";
import { catalogFromKit } from "@carcassonne/game-client/engine";
import { chromium } from "playwright";

import { illustratedFromGeo } from "../src/illustrated/from-geo";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = args.find((a) => a.endsWith(".png")) ?? new URL("../../../docs/screenshots/tiles-illustrated-sheet.png", import.meta.url).pathname;
const size = Number(flag("--size") ?? 256);
const cols = Number(flag("--cols") ?? 8);
const only = flag("--only")?.split(",");
const rots = args.includes("--rots") ? [0, 1, 2, 3] : [0];

const kit = await loadCoreKit();
const geo = new CoreGeo(kit.instance);
const defs = catalogFromKit(kit).all().filter((d) => !only || only.includes(d.id));
const tiles = defs.map((d) => illustratedFromGeo(geo.tile2d(d.id), geo.tile3d(d.id, 2).props));
const idx = (id: string) => tiles.findIndex((t) => t.id === id);

const boards: { title: string; cells: ([number, number] | null)[][] }[] = [];
void idx;

const built = await Bun.build({ entrypoints: [new URL("./sheet-entry.ts", import.meta.url).pathname], target: "browser", minify: false });
if (!built.success) throw new Error(built.logs.join("\n"));
const js = await built.outputs[0]!.text();
const dpr = 1;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#7a5129;font:12px/1.2 system-ui,sans-serif;color:#fff8e8}
#root{padding:12px}
.grid{display:grid;grid-template-columns:repeat(${cols * rots.length > 12 ? Math.min(16, cols * rots.length) : cols * rots.length},max-content);gap:10px}
.cell{text-align:center}
.cell canvas{box-shadow:2px 3px 6px rgba(0,0,0,.35)}
h2{font-size:14px;margin:18px 0 8px}
.board{display:inline-block;box-shadow:3px 4px 10px rgba(0,0,0,.4)}
</style></head><body><div id="root"></div>
<script>window.SHEET=${JSON.stringify({ tiles, size, rots, boards })};</script>
<script type="module">${js}</script></body></html>`;
const tmp = `${process.env.TMPDIR ?? "/tmp"}/illustrated-sheet.html`;
await Bun.write(tmp, html);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
const logs: string[] = [];
page.on("console", (m) => logs.push(m.text()));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`file://${tmp}`);
await page.waitForSelector("body[data-done]", { timeout: 60_000 }).catch(() => console.error(logs.join("\n")));
console.log(await page.textContent("#root > p"));
if (logs.length) console.log(logs.join("\n"));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
