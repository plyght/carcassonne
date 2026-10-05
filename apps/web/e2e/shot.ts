// Dev aid: screenshot a local HTML file (or URL) with the Playwright Chromium.
//   bun e2e/shot.ts <file-or-url> <out.png> [width] [height]
import { chromium } from "playwright";

const [src, out, w = "1600", h = "1200"] = process.argv.slice(2);
if (!src || !out) throw new Error("usage: shot.ts <file-or-url> <out.png> [width] [height]");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(/^https?:/.test(src) ? src : `file://${new URL(src, `file://${process.cwd()}/`).pathname}`);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
