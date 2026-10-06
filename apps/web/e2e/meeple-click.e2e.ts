// Regression check: a click on a figure hotspot (with a few px of hand jitter between press and
// release) places the meeple and never pans the board, and the board is not left in a stuck
// "drag mode" afterwards (a later button-less mouse move must not pan it either).
//   WEB_URL=http://localhost:3001 bun e2e/meeple-click.e2e.ts
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs: string[] = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

async function fail(msg: string): Promise<never> {
  console.error(logs.slice(-40).join("\n"));
  await browser.close();
  throw new Error(msg);
}

const ply = async (p: Page) => Number(await p.getAttribute("[data-testid=game-screen]", "data-ply"));
/** The board camera: the transform of the SVG's world group. */
const camera = (p: Page) => p.getAttribute("svg.cc-board > g[transform]", "transform");
const panning = (p: Page) => p.evaluate(() => document.querySelector("svg.cc-board")?.classList.contains("cc-panning") ?? false);

/** Press at (x, y), wander by the given jitter, release. */
async function jitterClick(p: Page, x: number, y: number, jitter: [number, number][]) {
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (const [dx, dy] of jitter) await p.mouse.move(x + dx, y + dy);
  await p.mouse.up();
}

const JITTERS: [number, number][][] = [
  [[2, 1], [3, 2]],
  [[-2, 3], [-4, 1]],
  [[4, 0], [1, -3]],
];

await ctx.addInitScript(() => {
  try {
    localStorage.setItem("carc.coach.v1", JSON.stringify({ done: true, seen: [] }));
  } catch {}
});
await page.goto(`${WEB}/play/new`);
await page.getByTestId("quick-start").click();
await page.waitForSelector("[data-testid=game-screen]", { timeout: 60_000 });

let placed = 0;
for (let turn = 0; turn < 6 && placed < 3; turn++) {
  const before = await ply(page);
  const target = page.locator(".cc-target").first();
  await target.waitFor({ timeout: 30_000 });
  const tb = await target.boundingBox();
  if (!tb) await fail("no target box");
  // Place the tile with a slightly jittery click too.
  await jitterClick(page, tb!.x + tb!.width / 2, tb!.y + tb!.height / 2, [[2, 2]]);
  const hotspot = page.locator("[data-hotspot]").first();
  const hasHotspot = await hotspot.waitFor({ timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  if (!hasHotspot) {
    // No legal figure spot this turn: skip the figure and let the bots answer.
    for (let i = 0; i < 40 && (await ply(page)) === before; i++) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
    }
  } else {
    const hb = await hotspot.boundingBox();
    if (!hb) await fail("no hotspot box");
    const cam0 = await camera(page);
    await jitterClick(page, hb!.x + hb!.width / 2, hb!.y + hb!.height / 2, JITTERS[placed % JITTERS.length]!);
    await page.waitForFunction((n) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > n, before, { timeout: 5_000 }).catch(() => fail(`turn ${turn}: hotspot click did not place the meeple`));
    if ((await camera(page)) !== cam0) await fail(`turn ${turn}: hotspot click panned the board (${cam0} -> ${await camera(page)})`);
    // The press must not leave a phantom drag behind: a plain hover move must not pan.
    const cam1 = await camera(page);
    await page.mouse.move(hb!.x + hb!.width / 2 + 60, hb!.y + hb!.height / 2 + 45, { steps: 6 });
    await page.mouse.move(hb!.x - 80, hb!.y - 30, { steps: 6 });
    if (await panning(page)) await fail(`turn ${turn}: board stuck in drag mode after the hotspot click`);
    if ((await camera(page)) !== cam1) await fail(`turn ${turn}: hover after the hotspot click panned the board`);
    placed++;
  }
  // Wait for both bots.
  await page.waitForFunction((n) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) >= n, before + 3, { timeout: 30_000 });
}
if (placed === 0) await fail("never got a figure hotspot to click");

// A real drag still pans, and its release does not place anything.
const cam2 = await camera(page);
const box = (await page.locator("svg.cc-board").boundingBox())!;
const p0 = await ply(page);
await page.mouse.move(box.x + 200, box.y + box.height - 120);
await page.mouse.down();
await page.mouse.move(box.x + 260, box.y + box.height - 90, { steps: 8 });
await page.mouse.up();
if ((await camera(page)) === cam2) await fail("a real drag did not pan the board");
if (await panning(page)) await fail("panning flag stuck after a real drag");
if ((await ply(page)) !== p0) await fail("drag release committed a move");

console.log(`meeple click ok: ${placed} jittery hotspot clicks placed, no pans`);

// ── 3D board: the same click-vs-drag rules for orbiting ────────────────────
await page.evaluate(() => {
  const k = "carc.settings.v1";
  const cur = JSON.parse(localStorage.getItem(k) ?? "{}");
  localStorage.setItem(k, JSON.stringify({ ...cur, style: "tabletop", camera: "tabletop" }));
});
await page.goto(`${WEB}/play/new`);
await page.getByTestId("quick-start").click();
await page.waitForSelector(`[data-testid=board-3d][data-ready="1"]`, { timeout: 90_000 });
await page.waitForTimeout(1500);
const mode = () => page.evaluate(() => (window as unknown as { __carc3d: { renderer: { cameraMode: string } } }).__carc3d.renderer.cameraMode);
const canvas = (await page.locator("[data-testid=board-3d-canvas]").boundingBox())!;
const mode0 = await mode();
// A jittery click (5px, past the old 4px threshold) must stay a click, not an orbit.
await jitterClick(page, canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.7, [[2, 1], [3, 2]]);
await page.waitForTimeout(300);
if ((await mode()) !== mode0) await fail(`3D: a jittery click orbited the camera (${mode0} -> ${await mode()})`);
// A press released over a HUD overlay must not leave the camera orbiting on hover.
const overlay = await page.evaluate(() => {
  const c = document.querySelector("[data-testid=board-3d-canvas]")!.getBoundingClientRect();
  for (const b of document.querySelectorAll("[data-testid=game-screen] button")) {
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (r.width && x > c.left && x < c.right && y > c.top && y < c.bottom && document.elementFromPoint(x, y)?.closest("button") === b) return { x, y };
  }
  return null;
});
if (overlay) {
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(overlay.x, overlay.y); // one jump: the canvas never sees this move
  await page.mouse.up();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.6, { steps: 4 });
  await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height * 0.6 + 40, { steps: 6 });
  await page.waitForTimeout(300);
  if ((await mode()) !== mode0) await fail(`3D: hover after a release off the canvas orbited the camera (${mode0} -> ${await mode()})`);
} else console.log("3D: no HUD overlay over the canvas; skipped the missed-release check");
console.log("3D click vs drag ok");
await browser.close();
