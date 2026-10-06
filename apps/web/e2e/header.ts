// Site header: screenshots on the landing, setup, settings and replays pages, at
// desktop and phone sizes, light and dark, plus the landing scrolled and the phone
// menu open. Writes docs/screenshots/header-*.png.
//
//   (web app on :3001)  bun e2e/header.ts
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const OUT = new URL("../../../docs/screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

const PAGES = [
  ["landing", "/"],
  ["setup", "/play/new"],
  ["settings", "/settings"],
  ["replays", "/replays"],
] as const;

async function shot(p: Page, name: string, height: number) {
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}header-${name}.png`, clip: { x: 0, y: 0, width: p.viewportSize()!.width, height } });
  console.log("shot", name);
}

for (const scheme of ["light", "dark"] as const) {
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: device === "phone" ? 2 : 1, isMobile: device === "phone", hasTouch: device === "phone" });
    await ctx.addInitScript((dark) => {
      try {
        localStorage.setItem("theme", dark ? "dark" : "light");
      } catch {}
    }, scheme === "dark");
    const p = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await p.goto(`${BASE}${path}`);
      await p.waitForSelector(".carc-header");
      await shot(p, `${name}-${device}-${scheme}`, device === "phone" ? 240 : 200);
    }
    // the landing once it scrolls: the header becomes a paper bar
    await p.goto(`${BASE}/`);
    await p.evaluate(() => document.querySelector("main")?.scrollTo(0, 400));
    await shot(p, `landing-scrolled-${device}-${scheme}`, device === "phone" ? 240 : 200);
    if (device === "phone") {
      await p.goto(`${BASE}/play/new`);
      await p.getByRole("button", { name: "Menu" }).click();
      await shot(p, `menu-open-phone-${scheme}`, 844);
    }
    await ctx.close();
  }
}
await browser.close();
