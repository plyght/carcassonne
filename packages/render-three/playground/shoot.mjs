// Screenshots of the playground in headless Chromium (WebGL2 on SwiftShader).
//   bun playground/serve.ts 5173 &
//   node playground/shoot.mjs                 # all docs/screenshots/3d-*.png
//   node playground/shoot.mjs one out.png "style=cartoon&camera=top" [w] [h]
//   node playground/shoot.mjs perf            # frame timings on a full board
// Uses the Playwright that ships with the environment (PLAYWRIGHT_MODULE to override)
// and the Chromium under /opt/pw-browsers (CHROMIUM to override).
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../docs/screenshots");
const base = process.env.PG_URL ?? "http://localhost:5173/";
const pwPath = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const { chromium } = await import(pwPath);

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

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});

async function open(query, w = 1600, h = 1000) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`console.${m.type()}:`, m.text().slice(0, 300));
  });
  await page.goto(`${base}?capture=1&backend=webgl&${query}`);
  await page.waitForFunction(() => window.__pg?.ready, null, { timeout: 120000 });
  return page;
}

async function shot(file, query, w = 1600, h = 1000, settle = 4) {
  const page = await open(query, w, h);
  // let the camera rig and any animation settle (manual clock)
  await page.evaluate((s) => window.__pg.advance(s, 30), settle);
  await page.evaluate(() => window.__pg.renderer.settle());
  const stats = await page.evaluate(() => window.__pg.renderer.stats());
  await page.screenshot({ path: file });
  console.log(file, JSON.stringify({ draws: stats.drawCalls, tris: stats.triangles, tiles: stats.tiles, backend: stats.backend, tier: stats.tier }));
  await page.close();
}

async function sideBySide(file, query) {
  const page = await open(query, 1200, 900);
  await page.evaluate(() => window.__pg.advance(4, 30));
  const png = await page.screenshot({ type: "png" });
  const ours = `data:image/png;base64,${png.toString("base64")}`;
  const cmp = await browser.newPage({ viewport: { width: 2420, height: 960 } });
  await cmp.goto(`${base}reference.webp`);
  await cmp.setContent(`<html><body style="margin:0;background:#1d1b18;color:#eee;font:20px system-ui;display:flex;gap:20px;padding:0 0 0 0">
    <figure style="margin:0;width:1200px"><img src="${base}reference.webp" style="width:1200px;height:900px;object-fit:cover"><figcaption style="padding:6px">Reference (tabletop-diorama-01.webp)</figcaption></figure>
    <figure style="margin:0;width:1200px"><img src="${ours}" style="width:1200px;height:900px"><figcaption style="padding:6px">render-three tabletop (WebGL2 / SwiftShader)</figcaption></figure>
  </body></html>`);
  await cmp.waitForLoadState("networkidle");
  await cmp.screenshot({ path: file });
  console.log(file);
  await cmp.close();
  await page.close();
}

async function perf(query) {
  const page = await open(query, 1600, 1000);
  await page.evaluate(() => window.__pg.advance(4, 20));
  const r = await page.evaluate(() => window.__pg.frames(20));
  console.log(query, JSON.stringify({ medianMs: r.median?.toFixed(1), minMs: r.min?.toFixed(1), draws: r.stats.drawCalls, tris: r.stats.triangles, tiles: r.stats.tiles, figures: r.stats.figures }));
  await page.close();
}

const mode = process.argv[2] ?? "all";
if (mode === "one") {
  await shot(resolve(process.argv[3]), process.argv[4] ?? "", Number(process.argv[5] ?? 1600), Number(process.argv[6] ?? 1000));
} else if (mode === "perf") {
  for (const tier of ["low", "medium", "high"]) await perf(`seed=7&moves=200&tier=${tier}&style=tabletop`);
  await perf(`seed=7&moves=200&tier=medium&style=cartoon`);
} else {
  const mid = "seed=7&moves=34";
  await shot(`${out}/3d-tabletop-tilt.png`, `${mid}&style=tabletop&camera=tabletop&tier=high`);
  await shot(`${out}/3d-tabletop-top.png`, `${mid}&style=tabletop&camera=top&tier=high`);
  await shot(`${out}/3d-cartoon.png`, `${mid}&style=cartoon&camera=tabletop&tier=high`);
  await shot(`${out}/3d-diorama.png`, `${mid}&style=diorama&camera=tabletop&tier=high`);
  await shot(`${out}/3d-tabletop-cinematic.png`, `${mid}&style=tabletop&camera=cinematic&tier=high`);
  await sideBySide(`${out}/3d-tabletop-vs-reference.png`, `${mid}&style=tabletop&camera=cinematic&tier=high`);
}
await browser.close();
