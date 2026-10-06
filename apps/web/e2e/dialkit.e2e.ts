// DialKit game controls: end-to-end walk-through with screenshots.
//
//   WEB_URL=http://localhost:3001 bun e2e/dialkit.e2e.ts
//
// setup (player slider, seat rows: meeple colour + bot tier, rule toggles, seed re-roll)
// → a vs-AI game on Classic, a few turns rotated with the tile dial → the HUD "Table"
// panel: switch to Tabletop 3D, change camera, nudge the view → ?tune: change the sun
// live on the 3D board, open the anim timeline, export style.json. Also settings,
// online room creation (clocks), dark mode and a phone. Screenshots go to
// docs/screenshots/dialkit-*.png.
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const OUT = process.env.SHOTS_DIR ?? new URL("../../../docs/screenshots/", import.meta.url).pathname;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors: string[] = [];
const watch = (p: Page, who: string) => p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const shot = async (p: Page, name: string, opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) => {
  await p.screenshot({ path: `${OUT}/dialkit-${name}.png`, timeout: 120_000, ...opts });
  console.log(`  shot dialkit-${name}.png`);
};
const gs = "[data-testid=game-screen]";
const attr = async (p: Page, n: string) => (await p.getAttribute(gs, n)) ?? "";
const ply = async (p: Page) => Number(await attr(p, "data-ply"));
async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `${OUT}/dialkit-FAIL.png` }).catch(() => {});
    throw e;
  }
  console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
async function setSettings(p: Page, patch: Record<string, unknown>) {
  await p.evaluate((patch) => {
    const k = "carc.settings.v1";
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? "{}"), ...patch }));
  }, patch);
}
async function waitMyTurn(p: Page, timeout = 90_000) {
  await p.waitForFunction(() => {
    const el = document.querySelector("[data-testid=game-screen]");
    return el?.getAttribute("data-my-turn") === "1" || el?.getAttribute("data-status") === "ended";
  }, undefined, { timeout });
}
/** Wait for the figure step, skip it, and wait for the move to commit. */
async function finishMove(p: Page, before: number) {
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 45_000 });
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.keyboard.press("s");
  await p.waitForFunction((b) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > b, before, { timeout: 30_000 });
}

/** First-game coach marks are covered by e2e/newplayer.ts; keep them out of the way here. */
const noCoach = () => {
  try {
    localStorage.setItem("carc.coach.v1", JSON.stringify({ done: true, seen: [] }));
  } catch {}
};
/** Setup opens on Quick start; seats and rules live under Customize. */
async function openCustomize(p: Page) {
  await p.getByTestId("customize-toggle").click();
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
await ctx.addInitScript(noCoach);
const page = await ctx.newPage();
page.setDefaultTimeout(90_000); // SwiftShader renders the 3D board on the CPU
watch(page, "desktop");
await page.goto(`${WEB}/`);
await setSettings(page, { style: "classic", camera: "top-down", botSpeed: "fast", motion: "full", tier: "low" });

// ── setup ───────────────────────────────────────────────────────────────────
await step("setup: DialKit controls", async () => {
  await page.goto(`${WEB}/play/new`);
  await openCustomize(page);
  const seats = page.locator(".carc-seat");
  await seats.first().waitFor();
  // vs AI starts with 3 seats (wait out hydration)
  await page.waitForFunction(() => document.querySelectorAll(".carc-seat").length === 3, undefined, { timeout: 15_000 });
  await page.waitForTimeout(500);
  // player count slider (keyboard)
  const players = page.getByRole("slider", { name: "Players" });
  await players.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelectorAll(".carc-seat").length === 4);
  // seat 2 takes green (seat 4 had it: colours swap)
  await page.getByRole("radiogroup", { name: "Seat 2 colour" }).getByRole("radio", { name: /^Green/ }).click();
  await page.waitForTimeout(250);
  const colors = await page.locator(".carc-meeple[aria-checked=true]").evaluateAll((els) => els.map((e) => e.getAttribute("data-color")));
  assert(colors[1] === "green" && new Set(colors).size === 4, `colours stay unique after a swap: ${colors}`);
  // seat 3: hard bot (listbox select with tier hints)
  await page.getByTestId("seat-2-player").click();
  await page.getByRole("option", { name: /Hard bot/ }).click();
  assert((await page.getByTestId("seat-2-player").textContent())?.includes("Hard bot"), "seat 3 is a hard bot");
  // house rules: River off, re-roll the seed
  await page.getByRole("radiogroup", { name: "The River" }).getByRole("radio", { name: "Off" }).click();
  await page.getByTestId("advanced-toggle").click();
  const seedBox = page.getByRole("textbox", { name: "Seed" });
  const seed0 = await seedBox.inputValue();
  await page.getByTestId("reroll-seed").click();
  assert((await seedBox.inputValue()) !== seed0, "re-roll changes the seed");
  // field edition select (DialKit SelectControl)
  await page.getByRole("button", { name: /Field scoring/ }).click();
  await page.getByRole("option", { name: "2nd edition" }).click();
  await page.getByRole("button", { name: /Field scoring/ }).click();
  await page.getByRole("option", { name: "3rd edition" }).click();
  await page.mouse.move(10, 10);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot(page, "setup");
  await page.setViewportSize({ width: 1440, height: 900 });
});

// ── a few turns with the rotation dial ──────────────────────────────────────
await step("game: rotate with the dial, place, skip", async () => {
  await page.getByTestId("start-game").click();
  await page.waitForSelector(gs, { timeout: 60_000 });
  const dial = page.getByTestId("rotation-dial");
  let rotated = 0;
  for (let turn = 0; turn < 3; turn++) {
    await waitMyTurn(page);
    const before = await ply(page);
    const target = page.locator(".cc-target").first();
    await target.waitFor({ timeout: 20_000 });
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // turn the dial: click (a quarter turn), then scroll over it
    const r0 = await dial.getAttribute("data-rot");
    await dial.click();
    await page.waitForTimeout(250);
    const db = (await dial.boundingBox())!;
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(350);
    if ((await dial.getAttribute("data-rot")) !== r0) rotated++;
    if (turn === 1) {
      await page.waitForTimeout(900); // painted tile bitmap for the new rotation
      await shot(page, "rotation-dial", { clip: { x: db.x - 16, y: db.y - 16, width: 300, height: db.height + 32 } });
    }
    // place where the dial points (keyboard: first legal spot, snapped to a legal rotation)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await finishMove(page, before);
  }
  assert(rotated > 0, "the dial rotated the tile in hand");
  await waitMyTurn(page);
  await page.waitForTimeout(600);
  await shot(page, "game");
});

// ── HUD panel: style, camera, view ──────────────────────────────────────────
await step("HUD panel: style + camera from the Table panel", async () => {
  await page.getByTestId("style-button").click();
  const panel = page.getByRole("dialog", { name: "Table settings" });
  await panel.waitFor();
  await page.waitForTimeout(400);
  await shot(page, "hud-panel");
  await panel.getByTestId("style-select").click();
  await page.waitForTimeout(600);
  await shot(page, "hud-style-select");
  await page.getByRole("option", { name: /Tabletop/ }).click();
  await page.waitForSelector(`[data-testid=board-3d][data-ready="1"][data-style="tabletop"]`, { timeout: 120_000 });
  await panel.locator("[data-testid=camera-switcher] [data-camera=orbit]").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-camera") === "orbit");
  await panel.locator("[data-testid=camera-switcher] [data-camera=tabletop]").click();
  // View → nudge pad (DialPad)
  await panel.getByRole("button", { name: "View" }).click();
  const pad = panel.locator(".dialkit-pad-surface");
  await pad.waitFor();
  await pad.scrollIntoViewIfNeeded();
  const pb = (await pad.boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width * 0.62, pb.y + pb.height * 0.4, { steps: 5 });
  await page.mouse.up();
  // Sound → a volume bus
  await panel.getByRole("button", { name: "Sound" }).click();
  await panel.getByRole("slider", { name: "Music" }).focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.documentElement.dataset.volume?.split(",")[1] === "0");
  await page.waitForTimeout(2500);
  await shot(page, "hud-3d");
  await page.keyboard.press("Escape");
  await page.mouse.click(720, 880);
  await panel.waitFor({ state: "detached" });
});

await step("3D turn with the dial", async () => {
  await waitMyTurn(page, 120_000);
  const before = await ply(page);
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("rotation-dial").click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await finishMove(page, before);
});

// ── ?tune: live style pack + anim timeline + export ─────────────────────────
await step("?tune: change lighting live, timeline, export", async () => {
  await waitMyTurn(page, 120_000);
  const url = new URL(page.url());
  url.search = "?tune";
  await page.goto(url.toString());
  await page.waitForSelector(`[data-testid=board-3d][data-ready="1"][data-style="tabletop"]`, { timeout: 120_000 });
  await page.waitForSelector("[data-testid=tune-mode]", { state: "attached" });
  await page.waitForSelector(".dialkit-timeline-clip", { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await shot(page, "tune");
  const board = { x: 330, y: 140, width: 760, height: 420 };
  const before = await page.screenshot({ clip: board, timeout: 120_000 });
  // Lighting → Sun → intensity to max, exposure up
  await page.getByRole("button", { name: "Sun", exact: true }).click();
  const intensity = page.locator(".dialkit-panel").getByRole("slider", { name: "Intensity" }).first();
  await intensity.focus();
  await page.keyboard.press("End");
  await page.locator(".dialkit-panel").getByRole("slider", { name: "Exposure" }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(3000);
  const after = await page.screenshot({ clip: board, timeout: 120_000 });
  assert(!before.equals(after), "the 3D board re-lit after the sun change");
  await shot(page, "tune-lighting");
  // anim timeline: open the tile-drop clip editor
  await page.locator(".dialkit-timeline-clip").first().click();
  await page.waitForTimeout(600);
  await shot(page, "tune-timeline");
  await page.keyboard.press("Escape");
  // export style.json
  const exportFolder = page.getByRole("button", { name: "Export", exact: true });
  await exportFolder.scrollIntoViewIfNeeded();
  if ((await exportFolder.getAttribute("aria-expanded")) === "false") await exportFolder.click();
  const dl = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
  await page.getByRole("button", { name: "Download style.json" }).click();
  const file = await dl;
  const out = await page.evaluate(() => window.__carcTuneExport ?? null);
  assert(out?.name === "style.json", "export produced style.json");
  const json = JSON.parse(out!.text) as { id: string; lighting: { sun: { intensity: number }; exposure: number } };
  assert(json.id === "tabletop" && json.lighting.sun.intensity === 6, `exported sun intensity ${json.lighting.sun.intensity}`);
  assert(json.lighting.exposure > 0.92, "exported exposure");
  console.log(`\n  exported style.json: sun ${json.lighting.sun.intensity}, exposure ${json.lighting.exposure}${file ? `, downloaded ${file.suggestedFilename()}` : ""}`);
  await page.waitForTimeout(500);
  await shot(page, "tune-export");
});

await step("?tune on Classic: palette panel", async () => {
  await setSettings(page, { style: "classic", camera: "top-down" });
  await page.reload();
  await page.waitForSelector(".cc-target, [data-testid=game-screen]", { timeout: 60_000 });
  await page.getByRole("button", { name: "Tile", exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, "tune-palette");
});
await page.goto(`${WEB}/?tune=0`);

// ── settings, online room, dark mode ────────────────────────────────────────
await step("settings + online (light / dark)", async () => {
  await setSettings(page, { style: "tabletop", camera: "tabletop" });
  await page.goto(`${WEB}/settings`);
  await page.waitForSelector(`[data-testid=board-3d][data-ready="1"]`, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, "settings");
  await page.goto(`${WEB}/online`);
  await page.getByRole("radiogroup", { name: "Clock" }).getByRole("radio", { name: "Per turn" }).click();
  await page.getByRole("slider", { name: "Seats" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("slider", { name: "Bots" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await shot(page, "online");
  const dark = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  watch(dark, "dark");
  await dark.goto(`${WEB}/play/new`);
  await openCustomize(dark);
  await dark.locator(".carc-seat").first().waitFor();
  await dark.waitForTimeout(800);
  await shot(dark, "setup-dark");
  await dark.goto(`${WEB}/settings`);
  await dark.waitForTimeout(2500);
  await shot(dark, "settings-dark");
  await dark.close();
});

// ── phone ───────────────────────────────────────────────────────────────────
await step("phone: setup + HUD panel", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.addInitScript(noCoach);
  watch(m, "phone");
  await m.goto(`${WEB}/`);
  await setSettings(m, { style: "classic", camera: "top-down", botSpeed: "fast" });
  await m.goto(`${WEB}/play/new`);
  await openCustomize(m);
  await m.locator(".carc-seat").first().waitFor();
  await m.waitForTimeout(600);
  await shot(m, "mobile-setup");
  await m.getByTestId("start-game").click();
  await waitMyTurn(m);
  await m.getByTestId("rotation-dial").tap();
  await m.waitForTimeout(500);
  await m.getByTestId("style-button").tap();
  await m.getByRole("dialog", { name: "Table settings" }).waitFor();
  await m.waitForTimeout(600);
  await shot(m, "mobile-hud");
  await m.close();
});

const real = errors.filter((e) => !/hydrat/i.test(e));
if (real.length) throw new Error(`page errors:\n${real.join("\n")}`);
await browser.close();
console.log("dialkit e2e: all good");
