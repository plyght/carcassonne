// Evaluate an expression in the playground page (debug helper).
//   node playground/debug.mjs "seed=7&moves=34" "JSON.stringify(window.__pg.renderer.rig.goal)"
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${process.env.PG_URL ?? "http://localhost:5173/"}?capture=1&backend=webgl&${process.argv[2] ?? ""}`);
await page.waitForFunction(() => window.__pg?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__pg.advance(4, 30));
for (const expr of process.argv.slice(3)) console.log(await page.evaluate(expr));
if (process.env.MOUSE) {
  const [mx, my] = process.env.MOUSE.split(",").map(Number);
  await page.mouse.move(mx, my);
  await page.mouse.move(mx + 1, my + 1);
}
if (process.env.SHOT) {
  await page.evaluate(() => window.__pg.advance(0.1, 2));
  await page.evaluate(() => window.__pg.renderer.settle());
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
