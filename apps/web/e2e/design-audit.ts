// Design audit: screenshot every screen at desktop / laptop / phone, light and dark.
//
//   WEB_URL=http://localhost:3001 OUT=/tmp/audit bun e2e/design-audit.ts [--only=menu,game] [--sizes=desktop] [--themes=light] [--3d]
//
// Needs the web app and the API server (for the online lobby; sign-up + a room).
// The first run prepares fixed-seed games (a mid-game vs AI, a hot-seat hand-over, a
// finished all-bot game) and an online room, and caches their storage in
// $OUT/state.json, so later runs (after a design change) shoot the same positions.
// Files: $OUT/<screen>-<size>-<theme>.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const OUT = process.env.OUT ?? "/tmp/design-audit";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1]?.split(",");
const ONLY = arg("only");
const SIZES = { desktop: { width: 1440, height: 900 }, laptop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const sizes = (arg("sizes") ?? Object.keys(SIZES)) as (keyof typeof SIZES)[];
const themes = (arg("themes") ?? ["light", "dark"]) as ("light" | "dark")[];
const with3d = process.argv.includes("--3d");
mkdirSync(OUT, { recursive: true });

const browser: Browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const gs = "[data-testid=game-screen]";
const SETTINGS = { style: "classic", camera: "top-down", botSpeed: "fast", motion: "reduced", tier: "low", showHints: false };

async function waitMyTurn(p: Page, timeout = 90_000) {
  await p.waitForFunction(
    () => {
      const el = document.querySelector("[data-testid=game-screen]");
      return el?.getAttribute("data-my-turn") === "1" || el?.getAttribute("data-status") === "ended";
    },
    undefined,
    { timeout },
  );
}

async function playTurn(p: Page) {
  await waitMyTurn(p);
  const before = Number(await p.getAttribute(gs, "data-ply"));
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "", undefined, { timeout: 30_000 });
  await p.keyboard.press("s");
  await p.waitForFunction((b) => Number(document.querySelector("[data-testid=game-screen]")?.getAttribute("data-ply")) > b, before, { timeout: 30_000 });
}

interface State {
  storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
  mid: string;
  hot: string;
  ended: string;
  room: string;
}

async function prepare(): Promise<State> {
  const ctx = await browser.newContext({ viewport: SIZES.desktop });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${WEB}/`);
  await page.evaluate((s) => localStorage.setItem("carc.settings.v1", JSON.stringify(s)), SETTINGS);
  const idOf = () => page.url().split("/play/local/")[1]!;

  // finished all-bot game (2 easy bots)
  console.log("prep: all-bot game");
  await page.goto(`${WEB}/play/new?mode=ai&players=2&seed=audit-ended`);
  await page.locator(".carc-seat").first().waitFor();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=seat-0-player]:visible").first().click();
  await page.getByRole("option", { name: /Easy bot/ }).first().click();
  await page.locator("[data-testid=seat-1-player]:visible").first().click();
  await page.getByRole("option", { name: /Easy bot/ }).first().click();
  await page.locator("[data-testid=start-game]:visible").first().click();
  await page.waitForSelector(gs);
  const ended = idOf();
  await page.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-status") === "ended", undefined, { timeout: 600_000 });

  // mid-game vs AI (4 seats), a few turns in
  console.log("prep: mid-game");
  await page.goto(`${WEB}/play/new?mode=ai&players=4&seed=audit-mid`);
  await page.locator(".carc-seat").first().waitFor();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=start-game]:visible").first().click();
  await page.waitForSelector(gs);
  const mid = idOf();
  for (let i = 0; i < 4; i++) await playTurn(page);
  await waitMyTurn(page);

  // hot-seat: after the first move the pass screen is up
  console.log("prep: hot-seat");
  await page.goto(`${WEB}/play/new?mode=hotseat&players=2&seed=audit-hot`);
  await page.locator(".carc-seat").first().waitFor();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=start-game]:visible").first().click();
  await page.waitForSelector(gs);
  const hot = idOf();
  await playTurn(page);

  // online: sign up, host a room (1 bot)
  console.log("prep: online room");
  await page.goto(`${WEB}/login`);
  await page.fill("input[name=name]", "Adela");
  await page.fill("input[name=email]", `adela-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "carcassonne-audit-pass");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.goto(`${WEB}/online`);
  const bots = page.getByRole("slider", { name: "Bots", exact: true });
  await bots.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/r\/[A-Z0-9]+$/, { timeout: 30_000 });
  const room = page.url().split("/r/")[1]!;

  const storage = await ctx.storageState();
  await ctx.close();
  return { storage, mid, hot, ended, room };
}

const statePath = `${OUT}/state.json`;
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : await prepare();
writeFileSync(statePath, JSON.stringify(state));

type Shot = { name: string; path: string; signedOut?: boolean; act?: (p: Page) => Promise<void>; ready?: string; full?: boolean };
const SCREENS: Shot[] = [
  { name: "menu", path: "/" },
  { name: "setup", path: "/play/new?seed=audit-setup", ready: ".carc-seat", full: true },
  { name: "game", path: `/play/local/${state.mid}`, ready: gs, act: async (p) => waitMyTurn(p) },
  {
    name: "figure",
    path: `/play/local/${state.mid}`,
    ready: gs,
    act: async (p) => {
      await waitMyTurn(p);
      // the cell with the most figure options among the first few targets
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.querySelector("[data-testid=game-screen]")?.getAttribute("data-pending") !== "");
    },
  },
  { name: "pass", path: `/play/local/${state.hot}`, ready: "[aria-labelledby=pass-title]" },
  { name: "end", path: `/play/local/${state.ended}`, ready: "[aria-labelledby=end-title]" },
  { name: "replays", path: "/replays", full: true },
  { name: "replay", path: `/replays/${state.ended}`, ready: "[aria-label='Scrub turns']" },
  { name: "online", path: "/online", full: true },
  { name: "lobby", path: `/r/${state.room}`, ready: "[data-seat-kind]", full: true },
  { name: "ranked", path: "/ranked" },
  { name: "profile", path: "/profile", full: true },
  { name: "settings", path: "/settings", full: true },
  { name: "tutorial", path: "/tutorial", full: true },
  { name: "signin", path: "/login", signedOut: true },
];

async function shootAll() {
  for (const theme of themes)
    for (const size of sizes) {
      for (const signedOut of [false, true]) {
        const list = SCREENS.filter((s) => !!s.signedOut === signedOut && (!ONLY || ONLY.includes(s.name)));
        if (!list.length) continue;
        const ctx = await browser.newContext({
          viewport: SIZES[size],
          colorScheme: theme,
          reducedMotion: "reduce",
          storageState: signedOut ? { cookies: [], origins: state.storage.origins } : state.storage,
          isMobile: size === "mobile",
          hasTouch: size === "mobile",
        });
        await ctx.addInitScript(
          ([t, s]) => {
            localStorage.setItem("theme", t);
            localStorage.setItem("carc.settings.v1", JSON.stringify(s));
          },
          [theme, SETTINGS] as const,
        );
        const page = await ctx.newPage();
        page.setDefaultTimeout(60_000);
        for (const s of list) {
          const file = `${OUT}/${s.name}-${size}-${theme}.png`;
          try {
            await page.goto(`${WEB}${s.path}`);
            if (s.ready) await page.locator(s.ready).first().waitFor();
            await page.waitForLoadState("networkidle").catch(() => {});
            if (s.act) await s.act(page);
            await page.mouse.move(1, 1);
            await page.waitForTimeout(700);
            if (s.full) {
              // the app scrolls <main>, not the document: grow the viewport to fit it
              const h = await page.evaluate(() => {
                const m = document.querySelector("main");
                return m ? m.scrollHeight + (document.querySelector("header")?.clientHeight ?? 0) : document.body.scrollHeight;
              });
              const vh = Math.min(3200, Math.max(SIZES[size].height, h));
              await page.setViewportSize({ width: SIZES[size].width, height: vh });
              await page.waitForTimeout(300);
              await page.screenshot({ path: file });
              await page.setViewportSize(SIZES[size]);
            } else await page.screenshot({ path: file });
            console.log(`  ${s.name}-${size}-${theme}`);
          } catch (e) {
            console.log(`  FAILED ${s.name}-${size}-${theme}: ${(e as Error).message.split("\n")[0]}`);
          }
        }
        await ctx.close();
      }
    }
}

async function shoot3d() {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: SIZES.desktop, colorScheme: theme, reducedMotion: "reduce", storageState: state.storage });
    await ctx.addInitScript(
      ([t, s]) => {
        localStorage.setItem("theme", t);
        localStorage.setItem("carc.settings.v1", JSON.stringify(s));
      },
      [theme, { ...SETTINGS, style: "tabletop", camera: "tabletop" }] as const,
    );
    const page = await ctx.newPage();
    page.setDefaultTimeout(180_000);
    await page.goto(`${WEB}/play/local/${state.mid}`);
    await page.waitForSelector("[data-testid=board-3d][data-ready='1']");
    await waitMyTurn(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/game3d-desktop-${theme}.png`, timeout: 180_000 });
    console.log(`  game3d-desktop-${theme}`);
    await ctx.close();
  }
}

if (!process.argv.includes("--no-2d")) await shootAll();
if (with3d) await shoot3d();
await browser.close();
