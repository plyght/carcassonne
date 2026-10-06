// Screenshots of the playground in headless Chromium (WebGL2 on SwiftShader).
//   bun playground/serve.ts 5173 &
//   node playground/shoot.mjs                 # all docs/screenshots/3d-*.png
//   node playground/shoot.mjs one out.png "style=cartoon&camera=top" [w] [h]
//   node playground/shoot.mjs perf            # frame timings on a full board
// Uses the Playwright that ships with the environment (PLAYWRIGHT_MODULE to override)
// and the Chromium under /opt/pw-browsers (CHROMIUM to override).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
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

async function shot(file, query, w = 1600, h = 1000, settle = 4, before = null) {
  const page = await open(query, w, h);
  // let the camera rig and any animation settle (manual clock)
  await page.evaluate((s) => window.__pg.advance(s, 12), settle);
  if (before) await page.evaluate(before);
  await page.evaluate(() => window.__pg.renderer.settle());
  const stats = await page.evaluate(() => window.__pg.renderer.stats());
  await page.screenshot({ path: file });
  console.log(file, JSON.stringify({ draws: stats.drawCalls, tris: stats.triangles, tiles: stats.tiles, backend: stats.backend, tier: stats.tier }));
  await page.close();
}

async function sideBySide(file, query) {
  // our render next to the reference photo (ImageMagick does the compositing)
  const tmp = `${file}.ours.png`;
  await shot(tmp, query, 1200, 900);
  const ref = resolve(here, "../../../docs/design/inspiration/tabletop-diorama-01.webp");
  execFileSync("convert", [
    "(", ref, "-resize", "x900", "-gravity", "south", "-background", "#1d1b18", "-splice", "0x40", "-fill", "#eee", "-pointsize", "22", "-annotate", "+0+8", "Reference: tabletop-diorama-01.webp", ")",
    "(", tmp, "-gravity", "south", "-background", "#1d1b18", "-splice", "0x40", "-fill", "#eee", "-pointsize", "22", "-annotate", "+0+8", "render-three tabletop (WebGL2 / SwiftShader, high tier)", ")",
    "-background", "#1d1b18", "-splice", "20x0", "+append", file,
  ]);
  unlinkSync(tmp);
  console.log(file);
}

async function perf(query) {
  const page = await open(query, 1600, 1000);
  await page.evaluate(() => window.__pg.advance(4, 20));
  const r = await page.evaluate(() => window.__pg.frames(5));
  r.stats.frameMs = r.stats.frameMs.toFixed(1);
  console.log(query, JSON.stringify({ medianMs: r.median?.toFixed(1), minMs: r.min?.toFixed(1), cpuMs: r.stats.frameMs, draws: r.stats.drawCalls, tris: r.stats.triangles, tiles: r.stats.tiles, figures: r.stats.figures }));
  await page.close();
}

const mode = process.argv[2] ?? "all";
if (mode === "one") {
  await shot(resolve(process.argv[3]), process.argv[4] ?? "", Number(process.argv[5] ?? 1600), Number(process.argv[6] ?? 1000));
} else if (mode === "perf") {
  for (const tier of ["low", "medium", "high"]) await perf(`seed=7&moves=80&tier=${tier}&style=tabletop`);
  await perf(`seed=7&moves=80&tier=medium&style=cartoon`);
} else {
  const only = process.argv[3]?.split(",");
  const want = (f) => !only || only.some((o) => f.includes(o));
  const mid = "seed=3&moves=45";
  if (want("3d-tabletop-tilt")) await shot(`${out}/3d-tabletop-tilt.png`, `${mid}&style=tabletop&camera=tabletop&tier=high`);
  if (want("3d-tabletop-top")) await shot(`${out}/3d-tabletop-top.png`, `${mid}&style=tabletop&camera=top&tier=high`);
  if (want("3d-tabletop-closeup")) await shot(`${out}/3d-tabletop-closeup.png`, `${mid}&style=tabletop&camera=cinematic&look=city&tier=high`);
  if (want("3d-cartoon")) await shot(`${out}/3d-cartoon.png`, `${mid}&style=cartoon&camera=cinematic&look=city&extent=1.6&tier=high`);
  if (want("3d-diorama")) await shot(`${out}/3d-diorama.png`, `${mid}&style=diorama&camera=cinematic&look=city&extent=1.6&tier=high`);
  // interaction: legal cells + ghost under the pointer
  if (want("3d-tabletop-interaction")) await shot(`${out}/3d-tabletop-interaction.png`, `${mid}&style=tabletop&camera=tabletop&tier=medium&hints=1`, 1600, 1000, 4, `(() => {
    const r = window.__pg.renderer; const p = r.hints.placements[0];
    const v = r.rig.active.position.clone().set(p.x + 0.5, 0, p.y + 0.5).project(r.rig.active);
    r.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: (v.x + 1) / 2 * innerWidth, clientY: (1 - v.y) / 2 * innerHeight, bubbles: true }));
    window.__pg.advance(0.05, 1);
  })()`);
  // scoring moment mid-animation (comic pop, feature pulse, meeple hopping home)
  if (want("3d-cartoon-score")) await shot(`${out}/3d-cartoon-score.png`, `seed=3&moves=30&style=cartoon&camera=cinematic&tier=high`, 1600, 1000, 3, `(() => { window.__pg.stepUntilScore(); window.__pg.advance(1.35, 12); })()`);
  if (want("3d-tabletop-vs-reference")) await sideBySide(`${out}/3d-tabletop-vs-reference.png`, `${mid}&style=tabletop&camera=cinematic&look=city&tier=high`);
}
await browser.close();
