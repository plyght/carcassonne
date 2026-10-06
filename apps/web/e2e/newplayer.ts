// New-player walkthrough: plays the way a first-timer would (quick start, the first
// turns with the coach marks and turn guide, scoring, the end, the rules sheet, and
// the whole tutorial) and screenshots every step to docs/screenshots/newplayer-*.png.
//
//   (web app on :3001)  bun e2e/newplayer.ts [only-prefix]
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const OUT = new URL("../../../docs/screenshots/", import.meta.url).pathname;
const only = process.argv[2] ?? "";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

const gs = "[data-testid=game-screen]";
const attr = (p: Page, n: string) => p.getAttribute(gs, n);
const ply = async (p: Page) => Number(await attr(p, "data-ply"));

async function shot(name: string, p: Page = page) {
  if (only && !name.startsWith(only)) return;
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}newplayer-${name}.png` });
  console.log("shot", name);
}

async function waitMyTurn(p: Page) {
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-my-turn") === "1", undefined, { timeout: 60_000 });
}

async function hoverTarget(p: Page) {
  const t = p.locator(".cc-target").first();
  await t.waitFor({ timeout: 20_000 });
  const b = (await t.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}

/** Place on the first glowing spot; claim the first offered figure if `claim`. */
async function playTurn(p: Page, claim: boolean) {
  await waitMyTurn(p);
  const b = await hoverTarget(p);
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 20_000 });
  const before = await ply(p);
  const buttons = p.locator(".carc-figures .carc-figure");
  const n = await buttons.count();
  if (claim && n > 1) await buttons.first().click();
  else await p.locator(".carc-figures .carc-figure[data-skip]").click();
  await p.waitForFunction((b0) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > b0, before, { timeout: 30_000 });
}

// ── setup ───────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/play/new`);
await page.getByTestId("quick-start").waitFor();
await page.waitForTimeout(1200);
await shot("01-setup");
await page.getByTestId("customize-toggle").click();
await page.getByTestId("advanced-toggle").click();
await page.setViewportSize({ width: 1440, height: 2200 });
await page.waitForTimeout(400);
await shot("02-setup-customize");
await page.setViewportSize({ width: 1440, height: 900 });

// ── quick start: the first turn with coach marks ────────────────────────────
await page.getByTestId("quick-start").click();
await page.waitForSelector(gs, { timeout: 60_000 });
await waitMyTurn(page);
await page.waitForTimeout(1500);
await shot("03-first-turn-coach-hand");
await page.getByTestId("coach-mark").getByRole("button", { name: "Got it" }).click();
await page.waitForTimeout(400);
await shot("04-coach-spots");
await page.getByTestId("coach-mark").getByRole("button", { name: "Got it" }).click();
await hoverTarget(page);
await page.waitForTimeout(500);
await shot("05-hover-spot");
const b = await hoverTarget(page);
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 20_000 });
await page.waitForTimeout(500);
await shot("06-claim-coach");
await page.getByTestId("coach-mark").getByRole("button", { name: "Got it" }).click();
const first = page.locator(".carc-figures .carc-figure").first();
await first.hover();
await page.waitForTimeout(300);
await shot("07-claim-glossary");
const before = await ply(page);
await first.click();
await page.waitForFunction((b0) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > b0, before);
await page.waitForTimeout(300);
await shot("08-bot-thinking");
await waitMyTurn(page);
await page.waitForTimeout(800);
await shot("09-after-bots-coach-scores");
for (let i = 0; i < 3; i++) {
  const g = page.getByTestId("coach-mark").getByRole("button", { name: "Got it" });
  if (await g.count()) await g.click();
  await page.waitForTimeout(200);
}

// ── a few turns, until something scores ─────────────────────────────────────
let scoredShot = false;
for (let turn = 0; turn < 14 && !scoredShot; turn++) {
  await playTurn(page, turn % 2 === 0);
  await waitMyTurn(page);
  await page.waitForTimeout(400);
  if (await page.locator(".carc-guide-score").count()) {
    await shot("10-scored");
    scoredShot = true;
  }
}
await shot("11-midgame");

// ── rules sheet ─────────────────────────────────────────────────────────────
await page.getByTestId("how-to-play-button").click();
await page.getByTestId("how-to-play").waitFor();
await page.waitForTimeout(1200);
await shot("12-rules");
await page.getByTestId("how-to-play").evaluate((el) => el.scrollTo(0, 900));
await page.waitForTimeout(500);
await shot("13-rules-scrolled");
await page.keyboard.press("Escape");

// ── the tutorial ────────────────────────────────────────────────────────────
const card = page.getByTestId("lesson-card");
const stepOf = () => card.getAttribute("data-step");

async function lesson(n: string, opts: { misfit?: boolean } = {}) {
  await card.waitFor();
  await waitMyTurn(page);
  await page.waitForTimeout(700);
  await shot(`${n}-a-place`);
  for (let i = 0; i < 4; i++) {
    const t = await hoverTarget(page);
    await page.waitForTimeout(250);
    await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
    await page.waitForTimeout(400);
    if ((await attr(page, "data-pending")) !== "") break;
    if (opts.misfit && i === 0) await shot(`${n}-b-does-not-fit`);
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot(`${n}-c-claim`);
  const before = await stepOf();
  await page.locator(".carc-figures .carc-figure").first().click();
  await page.waitForFunction(
    (b0) => {
      const c = document.querySelector("[data-testid=lesson-card]");
      return c?.getAttribute("data-done") === "true" || (c?.getAttribute("data-step") !== b0 && document.querySelector("[data-testid=game-screen]")?.getAttribute("data-my-turn") === "1");
    },
    before,
    { timeout: 15_000 },
  );
}

await page.goto(`${BASE}/tutorial`);
await card.waitFor({ timeout: 60_000 });
await lesson("20-tutorial-1");
await page.waitForTimeout(500);
await shot("20-tutorial-1-d-done");
await page.getByTestId("lesson-next").click();
await lesson("21-tutorial-2", { misfit: true });
await shot("21-tutorial-2-d-done");
await page.getByTestId("lesson-next").click();
await lesson("22-tutorial-3");
await shot("22-tutorial-3-d-bot");
await lesson("22-tutorial-3-finish");
await page.waitForTimeout(400);
await shot("22-tutorial-3-z-scored");
await page.getByTestId("lesson-next").click();
await lesson("23-tutorial-4");
await page.waitForTimeout(400);
await shot("23-tutorial-4-z-scored");
await page.getByTestId("lesson-next").click();
await lesson("24-tutorial-5");
await lesson("24-tutorial-5-finish");
await page.waitForTimeout(400);
await shot("24-tutorial-5-z-scored");
await page.getByTestId("lesson-next").click();
await lesson("25-tutorial-6");
await page.waitForTimeout(600);
await shot("25-tutorial-6-z-end");

// ── a whole quick-start game, to the end ────────────────────────────────────
if (!only || only.startsWith("3")) {
  await page.evaluate(() => {
    const k = "carc.settings.v1";
    const s = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...s, botSpeed: "fast" }));
  });
  await page.goto(`${BASE}/play/new`);
  await page.getByTestId("quick-start").click();
  await page.waitForSelector(gs, { timeout: 60_000 });
  for (let turn = 0; turn < 60; turn++) {
    const status = await attr(page, "data-status");
    if (status === "ended") break;
    try {
      await playTurn(page, turn % 3 === 0);
    } catch {
      if ((await attr(page, "data-status")) === "ended") break;
      throw new Error(`turn ${turn} failed`);
    }
    if (turn === 20) await shot("30-late-game");
  }
  await page.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-status") === "ended", undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await shot("31-game-end");
}

await browser.close();
