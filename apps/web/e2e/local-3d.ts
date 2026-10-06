// 3D smoke / play-through: a vs-AI game on the Tabletop style, played through picking
// on the WebGL2 canvas (headless Chromium = SwiftShader; WebGPU falls back), with a
// mid-game switch to Cartoon (a few turns), a detour through Classic and back, every
// camera mode, the ?debug overlay and the replay viewer in 3D. Screenshots go to
// docs/screenshots/web-3d-*.png. Also reports JS bytes fetched for 2D vs 3D.
//   WEB_URL=http://localhost:3001 bun e2e/local-3d.ts            (full game)
//   WEB_URL=... TURNS=4 bun e2e/local-3d.ts                       (quick smoke)
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const OUT = process.env.SHOTS_DIR ?? new URL("../../../docs/screenshots/", import.meta.url).pathname;
const MAX_TURNS = Number(process.env.TURNS ?? 200);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs: string[] = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
/** JS downloaded by the page so far (decoded bytes, from Resource Timing). */
const jsKiB = (p: Page) =>
  p.evaluate(() =>
    Math.round(
      performance
        .getEntriesByType("resource")
        .filter((e) => /\.js(\?|$)/.test(e.name))
        .reduce((a, e) => a + (e as PerformanceResourceTiming).decodedBodySize, 0) / 1024,
    ),
  );

async function fail(msg: string): Promise<never> {
  console.error(logs.slice(-60).join("\n"));
  await page.screenshot({ path: `${OUT}/web-3d-FAIL.png` }).catch(() => {});
  throw new Error(msg);
}

const screen = (p: Page) => p.locator("[data-testid=game-screen]");
const attr = async (p: Page, name: string) => (await screen(p).getAttribute(name)) ?? "";
const ply = async (p: Page) => Number(await attr(p, "data-ply"));

async function setSettings(p: Page, patch: Record<string, unknown>) {
  await p.evaluate((patch) => {
    const k = "carc.settings.v1";
    const cur = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...cur, ...patch }));
  }, patch);
}

async function waitReady(p: Page, style: string) {
  await p.waitForSelector(`[data-testid=board-3d][data-ready="1"][data-style="${style}"]`, { timeout: 90_000 });
}

/** Let the 3D board settle a few frames (SwiftShader is slow). */
async function frames(p: Page, n = 6) {
  await p.evaluate(
    (n) => new Promise<void>((res) => {
      let i = 0;
      const f = () => (++i >= n ? res() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    }),
    n,
  );
}

async function shot(p: Page, name: string) {
  await frames(p, 3);
  await p.screenshot({ path: `${OUT}/web-3d-${name}.png` });
  console.log("  shot", name);
}

async function waitMyTurn(p: Page, timeout = 60_000) {
  await p.waitForFunction(
    () => {
      const el = document.querySelector("[data-testid=game-screen]");
      return el?.getAttribute("data-status") === "ended" || (el?.getAttribute("data-my-turn") === "1" && el?.getAttribute("data-targets") !== "0");
    },
    undefined,
    { timeout },
  );
}

async function legalCells(p: Page): Promise<{ x: number; y: number }[]> {
  const s = (await p.getAttribute("[data-testid=board-3d]", "data-hints")) ?? "";
  return s ? s.split(";").map((c) => ({ x: Number(c.split(",")[0]), y: Number(c.split(",")[1]) })) : [];
}

/** Wait until the camera stops easing (projections stable across frames). */
async function settleCamera(p: Page) {
  let prev = "";
  for (let i = 0; i < 40; i++) {
    const cur = JSON.stringify(await p.evaluate(() => {
      const a = window.__carc3d!.project(0, 0);
      return [Math.round(a.x), Math.round(a.y)];
    }));
    if (cur === prev) return;
    prev = cur;
    await frames(p, 2);
  }
}

async function project(p: Page, x: number, y: number) {
  return p.evaluate(([x, y]) => window.__carc3d!.project(x, y), [x, y] as const);
}

/** Client point on the pending tile whose pick lands on a feature with a figure option, if any. */
async function hotspot(p: Page, cell: { x: number; y: number }) {
  return p.evaluate((cell) => {
    const r = window.__carc3d!;
    const pending = document.querySelector("[data-testid=game-screen]")!.getAttribute("data-pending");
    if (!pending) return null;
    for (let i = 1; i < 8; i++)
      for (let j = 1; j < 8; j++) {
        const pt = r.project(cell.x + i / 8, cell.y + j / 8);
        const pick = r.renderer.pick(pt.x, pt.y);
        const free = (document.elementFromPoint(pt.x, pt.y) as HTMLElement | null)?.dataset.testid === "board-3d-canvas";
        if (free && pick && pick.cell.x === cell.x && pick.cell.y === cell.y && pick.feature !== null) return { ...pt, feature: pick.feature };
      }
    return null;
  }, cell);
}

let turn = 0;
/** One human turn on the 3D board. Alternates pointer play (with meeple hotspots) and keyboard play. */
async function humanTurn(p: Page, opts: { shots?: boolean } = {}) {
  const before = await ply(p);
  const cells = await legalCells(p);
  if (!cells.length) await fail("no legal cells on the 3D board");
  turn++;
  // pointer play (with picking checks) early on; mostly keyboard later (SwiftShader is slow)
  const keyboard = turn % 3 === 0 || (turn > 12 && turn % 4 !== 0);
  if (keyboard) {
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("r");
    await p.keyboard.press("Enter");
  } else {
    const c = cells[turn % cells.length]!;
    await settleCamera(p);
    const pt = await project(p, c.x + 0.5, c.y + 0.5);
    await p.mouse.move(pt.x, pt.y, { steps: 3 });
    await frames(p, 3);
    // the pick under the projected centre must be that cell (picking accuracy)
    const picked = await p.evaluate(([x, y]) => window.__carc3d!.renderer.pick(x, y)?.cell, [pt.x, pt.y] as const);
    if (!picked || picked.x !== c.x || picked.y !== c.y) await fail(`pick mismatch at ${c.x},${c.y}: got ${JSON.stringify(picked)}`);
    await p.mouse.wheel(0, 120); // scroll over a legal spot rotates
    await frames(p, 2);
    if (opts.shots) await shot(p, "ghost-hover");
    // the camera may still ease (tiles landing): re-project + verify the pick before each click
    for (let i = 0; i < 8 && (await attr(p, "data-pending")) === ""; i++) {
      const hit = await p.evaluate(([x, y]) => {
        const q = window.__carc3d!.project(x + 0.5, y + 0.5);
        const cc = window.__carc3d!.renderer.pick(q.x, q.y)?.cell;
        return cc && cc.x === x && cc.y === y ? q : null;
      }, [c.x, c.y] as const);
      if (hit) {
        await p.evaluate((pt) => ((window as unknown as { __lastPt?: unknown }).__lastPt = pt), hit);
        await p.mouse.click(hit.x, hit.y);
      }
      await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 4_000 }).catch(() => {});
    }
  }
  try {
    await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 45_000 });
  } catch {
    const diag = await p.evaluate(() => {
      const el = document.querySelector("[data-testid=game-screen]")!;
      return { myTurn: el.getAttribute("data-my-turn"), targets: el.getAttribute("data-targets"), hints: document.querySelector("[data-testid=board-3d]")?.getAttribute("data-hints"), ply: el.getAttribute("data-ply") };
    });
    const at = keyboard ? null : await p.evaluate(() => { const m = (window as unknown as { __lastPt?: { x: number; y: number } }).__lastPt; return m ? (document.elementFromPoint(m.x, m.y) as HTMLElement | null)?.outerHTML.slice(0, 120) : null; });
    await fail(`tile not placed (keyboard=${keyboard}) ${JSON.stringify(diag)} at=${at}`);
  }
  const pending = (await attr(p, "data-pending")).split(",").map(Number);
  const cell = { x: pending[0]!, y: pending[1]! };
  // figure: click a hotspot on every other pointer turn, else skip with S
  if (!keyboard && turn % 2 === 1) {
    const h = await hotspot(p, cell);
    if (h) {
      await p.mouse.move(h.x, h.y);
      await frames(p, 2);
      if (opts.shots) await shot(p, "hotspot");
      await p.mouse.click(h.x, h.y);
      await p.waitForTimeout(150);
      const menu = p.getByTestId("figure-menu");
      if (await menu.isVisible().catch(() => false)) {
        if (opts.shots) await shot(p, "figure-menu");
        await menu.getByRole("menuitem").first().click();
      }
    }
  }
  const t0 = Date.now();
  while ((await ply(p)) === before && Date.now() - t0 < 30_000) {
    if (await p.getByTestId("figure-menu").isVisible().catch(() => false)) await p.getByTestId("figure-menu").getByRole("menuitem").last().click();
    else if ((await attr(p, "data-pending")) !== "") await p.keyboard.press("s");
    await p.waitForTimeout(250);
  }
  if ((await ply(p)) === before) await fail(`human move did not commit (pending=${await attr(p, "data-pending")})`);
}

async function switchStyle(p: Page, name: RegExp, id: string) {
  await p.getByTestId("style-button").click();
  const panel = p.getByRole("dialog", { name: "Table settings" });
  await panel.getByTestId("style-select").click();
  await p.getByRole("option", { name: name }).click();
  await p.keyboard.press("Escape");
  await p.waitForFunction((id) => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-style") === id, id);
}

// ── 2D baseline: JS fetched for a Classic game ──────────────────────────────
await page.goto(`${WEB}/`);
await setSettings(page, { style: "classic", camera: "top-down", botSpeed: "fast" });
await page.goto(`${WEB}/play/new`);
await page.getByTestId("start-game").click();
await page.waitForSelector("[data-testid=game-screen]", { timeout: 60_000 });
await page.waitForTimeout(1500);
const js2d = await jsKiB(page);
if ((await page.locator("[data-testid=board-3d]").count()) > 0) await fail("3D board mounted for a 2D style");

// ── 3D game ─────────────────────────────────────────────────────────────────
await setSettings(page, { style: "tabletop", camera: "tabletop" });
await page.goto(`${WEB}/play/new`);
await page.getByTestId("start-game").click();
await page.waitForSelector("[data-testid=game-screen]", { timeout: 60_000 });
await waitReady(page, "tabletop");
const js3d = await jsKiB(page);
const gameUrl = page.url();
console.log(`JS loaded (decoded): 2D game ${js2d} KiB, 3D game ${js3d} KiB (+${js3d - js2d} KiB)`);
const logStats = async () => console.log("  stats", JSON.stringify(await page.evaluate(() => window.__carc3d!.renderer.stats())));
await logStats();

await waitMyTurn(page);
await shot(page, "tabletop-start");
let turns = 0;
let phase = "tabletop";
while ((await attr(page, "data-status")) !== "ended" && turns < MAX_TURNS) {
  await waitMyTurn(page, 90_000);
  if ((await attr(page, "data-status")) === "ended") break;
  await humanTurn(page, { shots: turns === 1 });
  turns++;
  if (turns === 4) {
    // the rest of the game with reduced motion (SwiftShader runs ~1 fps): flipped from a
    // second tab on the Settings page, which also checks the live settings sync
    const tab = await ctx.newPage();
    await tab.goto(`${WEB}/settings`);
    await tab.getByRole("radiogroup", { name: "Motion" }).getByRole("radio", { name: "Reduced" }).click();
    await tab.locator("section[aria-label=\"Visual style\"]").scrollIntoViewIfNeeded();
    await tab.waitForSelector("[data-testid=board-3d][data-ready=\"1\"]", { timeout: 90_000 }).catch(() => {});
    await tab.waitForTimeout(3000);
    await tab.screenshot({ path: `${OUT}/web-3d-settings.png` });
    await tab.close();
  }
  if (turns === 3) {
    // cameras
    await page.getByTestId("style-button").click();
    for (const cam of ["top-down", "orbit", "cinematic", "tabletop"]) {
      await page.locator(`[data-testid=camera-switcher] [data-camera=${cam}]`).click();
      await page.waitForTimeout(900);
      if (cam !== "tabletop") await shot(page, `camera-${cam}`);
    }
    await page.keyboard.press("Escape");
  }
  if (turns === 5 && phase === "tabletop") {
    await waitMyTurn(page, 90_000); // bots done: the state is quiet while we switch
    const p0 = await ply(page);
    const scores = await attr(page, "data-scores");
    await switchStyle(page, /cartoon/i, "cartoon");
    await waitReady(page, "cartoon");
    if ((await ply(page)) !== p0 || (await attr(page, "data-scores")) !== scores) await fail("style switch lost game state");
    phase = "cartoon";
    await waitMyTurn(page);
    await shot(page, "cartoon-midgame");
  }
  if (turns === 9 && phase === "cartoon") {
    await switchStyle(page, /classic/i, "classic");
    await page.waitForSelector(".cc-target", { timeout: 20_000 });
    if ((await page.locator("[data-testid=board-3d]").count()) > 0) await fail("3D board not freed after switching to 2D");
    await shot(page, "switch-classic");
    await switchStyle(page, /tabletop/i, "tabletop");
    await waitReady(page, "tabletop");
    phase = "tabletop2";
  }
  if (turns === 11) {
    // ?debug overlay (and resume from storage)
    await page.goto(`${gameUrl}?debug`);
    await waitReady(page, "tabletop");
    await page.waitForSelector("[data-testid=debug-overlay]", { timeout: 20_000 });
    await waitMyTurn(page);
    await shot(page, "debug-overlay");
  }
  if (turns % 5 === 0) await logStats();
  if (turns % 5 === 0) console.log(`  turn ${turns} ply ${await ply(page)} scores ${await attr(page, "data-scores")}`);
}
const ended = (await attr(page, "data-status")) === "ended";
console.log(`played ${turns} human turns; ended=${ended}; scores ${await attr(page, "data-scores")}`);
if (ended) {
  await page.waitForTimeout(1500);
  await shot(page, "tabletop-end");
  // replay viewer in 3D: scrub to the start, then step forward (animated)
  const id = gameUrl.split("/").pop()!.split("?")[0];
  await page.goto(`${WEB}/replays/${id}`);
  await waitReady(page, "tabletop");
  await page.getByLabel("Scrub turns").fill("20");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Step forward" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "replay");
}
// ── phone: touch tap places a tile ──
await page.close(); // free the desktop board (SwiftShader shares the CPU)
{
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const m = await mctx.newPage();
  m.on("pageerror", (e) => logs.push(`[pageerror] mobile: ${e.message}`));
  await m.goto(`${WEB}/`);
  await m.evaluate(() => localStorage.setItem("carc.settings.v1", JSON.stringify({ style: "cartoon", camera: "tabletop", botSpeed: "fast", motion: "reduced" })));
  await m.goto(`${WEB}/play/new`);
  await m.getByTestId("start-game").click();
  await m.waitForSelector(`[data-testid=board-3d][data-ready="1"][data-style="cartoon"]`, { timeout: 180_000 });
  await waitMyTurn(m);
  const tier = await m.evaluate(() => window.__carc3d!.renderer.stats().tier);
  if (tier !== "low") await fail(`mobile auto tier should be low, got ${tier}`);
  const cells = await legalCells(m);
  for (let i = 0; i < 6 && (await m.getAttribute("[data-testid=game-screen]", "data-pending")) === ""; i++) {
    const hit = await m.evaluate(([x, y]) => {
      const q = window.__carc3d!.project(x + 0.5, y + 0.5);
      const cc = window.__carc3d!.renderer.pick(q.x, q.y)?.cell;
      return cc && cc.x === x && cc.y === y ? q : null;
    }, [cells[0]!.x, cells[0]!.y] as const);
    if (hit) await m.touchscreen.tap(hit.x, hit.y);
    await m.waitForTimeout(2000);
  }
  if ((await m.getAttribute("[data-testid=game-screen]", "data-pending")) === "") await fail("touch tap did not place the tile");
  await frames(m, 3);
  await m.screenshot({ path: `${OUT}/web-3d-mobile.png` });
  console.log("  shot mobile");
  await mctx.close();
}

if (logs.some((l) => l.startsWith("[pageerror]"))) await fail("page errors:\n" + logs.filter((l) => l.startsWith("[pageerror]")).join("\n"));
await browser.close();
