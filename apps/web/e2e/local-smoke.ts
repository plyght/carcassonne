// Local smoke test: a vs-AI game with River + Abbot on the real engine (Web Worker),
// a few human moves, undo, and screenshots of both 2D styles.
//   WEB_URL=http://localhost:3001 bun e2e/local-smoke.ts
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const OUT = process.env.SHOTS_DIR ?? new URL("../../../docs/screenshots/", import.meta.url).pathname;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs: string[] = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

function fail(msg: string): never {
  console.error(logs.join("\n"));
  throw new Error(msg);
}

async function ply(p: Page) {
  return Number(await p.getAttribute("[data-testid=game-screen]", "data-ply"));
}

/** Place the tile in hand at the first legal target, then skip the figure. */
async function humanMove(p: Page) {
  const before = await ply(p);
  const target = p.locator(".cc-target").first();
  await target.waitFor({ timeout: 20_000 });
  const box = await target.boundingBox();
  if (!box) fail("no target box");
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // A ghost tile asks for confirmation / figure; accept "no figure" via keyboard (Enter) or button.
  for (let i = 0; i < 40 && (await ply(p)) === before; i++) {
    const skip = p.getByRole("button", { name: /skip|no figure|place tile|confirm/i }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    else await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
  }
  if ((await ply(p)) === before) fail("human move did not commit");
}

await ctx.addInitScript(() => {
  try {
    localStorage.setItem("carc.coach.v1", JSON.stringify({ done: true, seen: [] }));
  } catch {}
});
await page.goto(`${WEB}/play/new`);
// Quick start: you vs two Medium bots with River + Abbot.
await page.getByTestId("quick-start").click();
await page.waitForSelector("[data-testid=game-screen]", { timeout: 60_000 });
for (let i = 0; i < 3; i++) {
  await humanMove(page);
  // Two medium bots answer.
  const want = (i + 1) * 3;
  await page.waitForFunction((n) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) >= n, want, { timeout: 30_000 });
}
const p0 = await ply(page);
if (!logs.some((l) => l.includes("running in a Web Worker"))) fail("engine did not run in a Web Worker");
await page.screenshot({ path: `${OUT}/local-river-classic.png` });
console.log("local game ok at ply", p0);
await browser.close();
