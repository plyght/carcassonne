// Polish pass: the landing (each section), the header at rest and scrolled, setup,
// settings, an in-game HUD with the rules sheet, and the tutorial, at desktop and
// phone sizes in light and dark. Writes docs/screenshots/polish-*.png.
//
//   (web app on :3001)  bun e2e/polish.ts [only-prefix]
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const OUT = new URL("../../../docs/screenshots/", import.meta.url).pathname;
const only = process.argv[2] ?? "";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function shot(p: Page, name: string, wait = 600) {
  if (only && !name.startsWith(only)) return;
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${OUT}polish-${name}.png` });
  console.log("shot", name);
}

/** Scroll <main> so the element sits near the top, then let reveals settle. */
async function scrollTo(p: Page, selector: string, offset = 72) {
  await p.evaluate(
    ([sel, off]) => {
      const main = document.querySelector("main")!;
      const el = document.querySelector(sel as string)!;
      main.scrollTo(0, main.scrollTop + el.getBoundingClientRect().top - (off as number));
    },
    [selector, offset] as const,
  );
  await p.waitForTimeout(900);
}

async function waitMyTurn(p: Page) {
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-my-turn") === "1", undefined, { timeout: 60_000 });
}

/** Place on the first glowing spot and claim the first figure offered (or skip). */
async function playTurn(p: Page) {
  await waitMyTurn(p);
  const t = p.locator(".cc-target").first();
  await t.waitFor({ timeout: 20_000 });
  const b = (await t.boundingBox())!;
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 20_000 });
  const before = Number(await p.getAttribute("[data-testid=game-screen]", "data-ply"));
  const figures = p.locator(".carc-figures .carc-figure");
  if ((await figures.count()) > 1) await figures.first().click();
  else await p.locator(".carc-figures .carc-figure[data-skip]").click();
  await p.waitForFunction((b0) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > b0, before, { timeout: 30_000 });
}

const wants =(prefix: string) => !only || prefix.startsWith(only) || only.startsWith(prefix);

for (const scheme of ["light", "dark"] as const) {
  for (const [device, viewport] of [
    ["desktop", { width: 1280, height: 880 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    const phone = device === "phone";
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
    await ctx.addInitScript((dark) => {
      try {
        localStorage.setItem("theme", dark ? "dark" : "light");
        // the steady state: the first-game coach marks are already done
        if (!location.search.includes("first")) localStorage.setItem("carc.coach.v1", JSON.stringify({ done: true, seen: [] }));
      } catch {}
    }, scheme === "dark");
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("[pageerror]", e.message));
    const tag = `${device}-${scheme}`;

    if (wants("landing")) {
      await p.goto(`${BASE}/?live=0`);
      await p.waitForSelector(".lp-hero");
      await shot(p, `landing-top-${tag}`, 2200);
      await scrollTo(p, ".lp-how");
      await shot(p, `landing-how-${tag}`);
      await scrollTo(p, ".lp-styles");
      await shot(p, `landing-showcase-${tag}`);
      await scrollTo(p, ".lp-ways");
      await shot(p, `landing-ways-${tag}`);
      await p.evaluate(() => document.querySelector("main")!.scrollTo(0, 1e6));
      await p.waitForTimeout(900);
      await shot(p, `landing-footer-${tag}`);
      await p.evaluate(() => document.querySelector("main")!.scrollTo(0, 300));
      await shot(p, `header-scrolled-${tag}`);
    }
    if (wants("setup")) {
      await p.goto(`${BASE}/play/new`);
      await p.getByTestId("quick-start").waitFor();
      await shot(p, `setup-${tag}`);
    }
    if (wants("settings")) {
      await p.goto(`${BASE}/settings`);
      await p.waitForTimeout(800);
      await shot(p, `settings-${tag}`);
    }
    if (wants("game")) {
      await p.goto(`${BASE}/play/new`);
      await p.getByTestId("quick-start").click();
      await p.waitForSelector("[data-testid=game-screen]", { timeout: 60_000 });
      await p.waitForTimeout(2500);
      await shot(p, `game-start-${tag}`);
      const skip = p.getByRole("button", { name: "Skip tips" });
      if (await skip.count()) await skip.click().catch(() => {});
      // a few turns so the board, the scores and the log have something in them
      for (let i = 0; i < 3; i++) await playTurn(p);
      // the feed, caught while a new line blurs in
      await playTurn(p);
      await p.waitForFunction(() => document.querySelectorAll(".carc-feed-line").length > 0, undefined, { timeout: 30_000 }).catch(() => {});
      await shot(p, `game-feed-mid-${tag}`, 120);
      await waitMyTurn(p);
      await shot(p, `game-${tag}`, 1500);
      await shot(p, `game-feed-${tag}`, 0);
      if (!phone) {
        await p.hover(".carc-feed-history");
        await shot(p, `game-feed-history-${tag}`, 500);
        await p.mouse.move(640, 440);
      }
      // the rules sheet
      await p.getByTestId("how-to-play-button").click();
      await p.getByTestId("how-to-play").waitFor();
      await shot(p, `game-rules-${tag}`);
      await p.getByTestId("how-to-play").evaluate((el) => el.scrollTo(0, 620));
      await shot(p, `game-rules-features-${tag}`, 500);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(300);
      // the table popover, mid-open and open
      if (!phone) {
        await p.getByTestId("style-button").click();
        await p.waitForTimeout(70);
        await shot(p, `game-table-opening-${tag}`, 0);
        await shot(p, `game-table-${tag}`, 500);
        await p.keyboard.press("Escape");
        await p.waitForTimeout(300);
      }
      // a reaction, caught mid-flight
      await p.getByRole("button", { name: "Reactions" }).click();
      await p.getByRole("button", { name: "React 👍" }).click();
      await p.waitForTimeout(150);
      await p.getByRole("button", { name: "React 👏" }).click().catch(() => {});
      await shot(p, `game-reaction-${tag}`, 550);
    }
    if (wants("tutorial")) {
      await p.goto(`${BASE}/tutorial`);
      await p.waitForTimeout(2500);
      await shot(p, `tutorial-${tag}`);
    }
    await ctx.close();
  }
}
await browser.close();
