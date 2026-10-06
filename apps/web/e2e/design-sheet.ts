// Before/after sheet: two audit screenshots side by side (or stacked for phones).
//
//   bun e2e/design-sheet.ts <out.png> <title> <before.png> <after.png> [<before2.png> <after2.png> …]
//
// Pairs are laid out as rows: "Before" on the left, "After" on the right.
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

const [out, title, ...files] = process.argv.slice(2);
if (!out || !title || files.length < 2 || files.length % 2) throw new Error("usage: design-sheet.ts <out.png> <title> <before.png> <after.png> …");
const uri = (f: string) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const rows: string[] = [];
for (let i = 0; i < files.length; i += 2) {
  const label = files[i]!.split("/").pop()!.replace(/\.png$/, "");
  rows.push(`<div class="row"><figure><figcaption>Before · ${label}</figcaption><img src="${uri(files[i]!)}"></figure><figure><figcaption>After · ${label}</figcaption><img src="${uri(files[i + 1]!)}"></figure></div>`);
}
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:32px;background:#2a2119;font:500 16px system-ui,sans-serif;color:#f3e7d3}
h1{margin:0 0 24px;font:400 28px Georgia,serif}
.row{display:flex;gap:24px;align-items:flex-start;margin-bottom:32px}
figure{margin:0;flex:1;min-width:0}
figcaption{margin-bottom:8px;color:#d9c7a8}
img{display:block;width:100%;border-radius:8px;box-shadow:0 10px 30px -10px #000}
</style><h1>${title}</h1>${rows.join("")}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: Number(process.env.SHEET_WIDTH ?? 2000), height: 800 } });
await page.setContent(html);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
