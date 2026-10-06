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

const wants = (prefix: string) => !only || prefix.startsWith(only) || only.startsWith(prefix);

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
      await shot(p, `game-${tag}`);
      const coach = p.getByTestId("coach-mark").getByRole("button", { name: "Got it" });
      for (let i = 0; i < 4 && (await coach.count()); i++) await coach.click().catch(() => {});
      const rules = p.getByRole("button", { name: /rules/i }).first();
      if (await rules.count()) {
        await rules.click().catch(() => {});
        await shot(p, `rules-${tag}`);
        await p.keyboard.press("Escape");
      }
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
