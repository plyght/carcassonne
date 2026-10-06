// Online end-to-end test (real engine, real server, two browsers).
//
//   bun run e2e            (from apps/web; see README "Run locally")
//
// Needs Postgres (DATABASE_URL in apps/server/.env, migrated) and the web app on
// WEB_URL (default http://localhost:3001) built/started with
// NEXT_PUBLIC_SERVER_URL=http://localhost:3000. The script starts the API server
// itself on port 3000 (twice: normal, then FORCE_POLLING=true) unless
// E2E_EXTERNAL_SERVER=1, in which case the polling phase is skipped.
//
// Covers: sign-up + guest join of an invite room by code, 10+ turns over WebSockets
// with both clients in sync, reload/resume, an emoji reaction, one client switching
// live to the 3D Tabletop style and playing by picking on the WebGL canvas while the
// other stays on Classic, forced polling mode, and a bot seat played by the server's
// queue consumer (in-process scheduler).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const API = process.env.SERVER_URL ?? "http://localhost:3000";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? `${ROOT}docs/screenshots`;
const EXTERNAL = process.env.E2E_EXTERNAL_SERVER === "1";
const T = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });

// ── tiny harness ─────────────────────────────────────────────────────────────

const results: { name: string; ok: boolean; ms: number; error?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String((e as Error)?.stack ?? e) });
    console.log("FAILED");
    throw e;
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── server process ───────────────────────────────────────────────────────────

let server: ChildProcess | null = null;
async function startServer(env: Record<string, string> = {}) {
  if (EXTERNAL) return;
  await stopServer();
  server = spawn(process.execPath, ["api/server.ts"], {
    cwd: `${ROOT}apps/server`,
    env: { ...process.env, PORT: "3000", SCHEDULER: "local", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout?.on("data", (d) => (log += d));
  server.stderr?.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${API}/healthz`);
      if (r.ok) return;
    } catch {}
    if (server.exitCode !== null) throw new Error(`server exited:\n${log}`);
    await sleep(200);
  }
  throw new Error(`server did not start:\n${log}`);
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.kill("SIGTERM");
  await new Promise((r) => (s.exitCode !== null ? r(null) : s.once("exit", r)));
  // Wait for the port to be free.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${API}/healthz`);
      await sleep(100);
    } catch {
      return;
    }
  }
}

// ── page helpers ─────────────────────────────────────────────────────────────

const errors: string[] = [];
function watch(page: Page, who: string) {
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|WebSocket connection|ERR_CONNECTION_REFUSED|status of 4\d\d/.test(m.text()))
      errors.push(`${who}: ${m.text()}`);
  });
}

const gs = "[data-testid=game-screen]";
async function attr(p: Page, name: string) {
  return (await p.getAttribute(gs, name, { timeout: T })) ?? "";
}
async function ply(p: Page) {
  return Number(await attr(p, "data-ply"));
}
async function waitAttr(p: Page, name: string, pred: string, arg: unknown, timeout = T) {
  await p.waitForFunction(
    ([n, src, a]) => {
      const v = document.querySelector("[data-testid=game-screen]")?.getAttribute(n as string);
      // eslint-disable-next-line no-new-func
      return v !== null && v !== undefined && (new Function("v", "a", `return ${src}`) as (v: string, a: unknown) => boolean)(v, a);
    },
    [name, pred, arg] as const,
    { timeout },
  );
}
const waitPly = (p: Page, n: number, timeout = T) => waitAttr(p, "data-ply", "Number(v) >= a", n, timeout);

/** Same public state on every page (ply, scores, board incl. figures, turn). */
async function assertInSync(pages: Page[]) {
  const snap = async (p: Page) => ({
    ply: await attr(p, "data-ply"),
    scores: await attr(p, "data-scores"),
    board: await attr(p, "data-board"),
    current: await attr(p, "data-current"),
  });
  const [a, ...rest] = await Promise.all(pages.map(snap));
  for (const b of rest) assert(JSON.stringify(a) === JSON.stringify(b), `clients out of sync:\n${JSON.stringify(a)}\n${JSON.stringify(b)}`);
}

/** Legal cells shown by the 3D board ("" when it is not mounted / not this client's turn). */
async function hints3d(p: Page): Promise<string> {
  const b = p.locator("[data-testid=board-3d][data-ready='1']");
  return (await b.count()) ? ((await b.getAttribute("data-hints")) ?? "") : "";
}

/** Whoever has the turn places the tile at a legal spot and maybe a figure. */
async function playTurn(pages: Page[], turn: number) {
  const before = await ply(pages[0]!);
  let mover = null as Page | null;
  for (let i = 0; i < 300 && !mover; i++) {
    for (const p of pages)
      if ((await attr(p, "data-my-turn")) === "1" && ((await p.locator(".cc-target").count()) > 0 || (await hints3d(p)) !== "")) mover = p;
    if (!mover) await sleep(100);
  }
  assert(mover, `nobody can move at ply ${before}`);
  const cells3d = await hints3d(mover);
  if (cells3d) {
    // 3D: click the projected centre of a legal cell on the WebGL canvas
    const list = cells3d.split(";");
    const [x, y] = list[turn % list.length]!.split(",").map(Number) as [number, number];
    const pt = await mover.evaluate(([x, y]) => window.__carc3d!.project(x + 0.5, y + 0.5), [x, y] as const);
    await mover.mouse.move(pt.x, pt.y);
    await mover.mouse.click(pt.x, pt.y);
    await waitAttr(mover, "data-pending", "v !== ''", null, 15_000);
    await mover.keyboard.press(turn % 3 === 0 ? "1" : "s");
    await mover.waitForTimeout(200);
    if ((await ply(mover)) === before) await mover.keyboard.press("s");
    for (const p of pages) await waitPly(p, before + 1, 60_000);
    return;
  }
  const targets = mover.locator(".cc-target");
  const n = await targets.count();
  const box = await targets.nth(turn % n).boundingBox();
  assert(box, "target has no box");
  await mover.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Figure choice: every third turn take the first offered figure (key 1), else skip (Enter).
  await mover.waitForTimeout(150);
  await mover.keyboard.press(turn % 3 === 0 ? "1" : "Enter");
  await mover.waitForTimeout(100);
  if ((await ply(mover)) === before) await mover.keyboard.press("Enter");
  for (const p of pages) await waitPly(p, before + 1);
}

async function signUp(ctx: BrowserContext, name: string) {
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${WEB}/login`);
  await page.fill("input[name=name]", name);
  await page.fill("input[name=email]", `${name.toLowerCase()}-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "carcassonne-e2e-pass");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: T });
  return page;
}

async function createRoom(host: Page, opts: { seats: number; bots: number; river?: boolean }) {
  await host.goto(`${WEB}/online`);
  await host.getByRole("button", { name: String(opts.seats), exact: true }).first().click();
  await host.locator("section", { hasText: "Host a room" }).getByRole("button", { name: String(opts.bots), exact: true }).last().click();
  if (opts.river === false) await host.getByRole("switch", { name: "The River" }).click();
  await host.getByTestId("create-room").click();
  await host.waitForURL(/\/r\/[A-Z0-9]+$/, { timeout: T });
  const code = host.url().split("/r/")[1]!;
  await host.locator("[data-seat-kind=human]").first().waitFor({ timeout: T });
  return code;
}

async function guestJoin(guest: Page, code: string, nickname: string) {
  await guest.goto(`${WEB}/online`);
  await guest.getByLabel("Room code").fill(code);
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await guest.waitForURL(new RegExp(`/r/${code}$`), { timeout: T });
  await guest.getByLabel("Nickname").fill(nickname);
  await guest.getByTestId("take-seat").click();
  await guest.getByText("(you)").waitFor({ timeout: T });
}

async function startGame(host: Page, others: Page[]) {
  await host.getByTestId("start-online").click();
  for (const p of [host, ...others]) {
    await p.waitForURL(/\/play\/online\//, { timeout: T });
    await p.waitForSelector(gs, { timeout: 60_000 });
  }
  return host.url().split("/play/online/")[1]!;
}

// ── the test ─────────────────────────────────────────────────────────────────

let browser: Browser | null = null;
try {
  await startServer();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const viewport = { width: 1400, height: 880 };
  const ctxA = await browser.newContext({ viewport });
  const ctxB = await browser.newContext({ viewport });

  let alice!: Page;
  let bob!: Page;
  let code = "";

  await step("host signs up, guest joins the invite room by code", async () => {
    alice = await signUp(ctxA, "Alice");
    bob = await ctxB.newPage();
    watch(bob, "bob");
    code = await createRoom(alice, { seats: 2, bots: 0 });
    await guestJoin(bob, code, "Bob");
    await alice.locator("[data-seat-kind=human]").nth(1).waitFor({ timeout: T });
    await alice.screenshot({ path: `${SHOTS}/online-lobby.png` });
  });

  await step("host starts; both clients connect over WebSockets", async () => {
    await startGame(alice, [bob]);
    for (const p of [alice, bob]) await waitAttr(p, "data-connection", "v === a", "open");
    await assertInSync([alice, bob]);
  });

  await step("12 turns over WebSockets with the real engine, clients in sync", async () => {
    for (let t = 0; t < 12; t++) {
      await playTurn([alice, bob], t);
      await assertInSync([alice, bob]);
      if (t === 5) await alice.screenshot({ path: `${SHOTS}/online-alice.png` });
    }
    assert((await ply(alice)) >= 12, "fewer than 12 plies");
    await bob.screenshot({ path: `${SHOTS}/online-bob.png` });
  });

  await step("guest reloads mid-game and resumes", async () => {
    const before = await ply(alice);
    await bob.reload();
    await bob.waitForSelector(gs, { timeout: 60_000 });
    await waitPly(bob, before);
    await waitAttr(bob, "data-connection", "v === a", "open");
    await assertInSync([alice, bob]);
    for (let t = 0; t < 2; t++) await playTurn([alice, bob], 20 + t);
    await assertInSync([alice, bob]);
  });

  await step("emoji reaction reaches the other client", async () => {
    await alice.getByRole("button", { name: "React 👍" }).click();
    await waitAttr(bob, "data-reactions", "v.includes(a)", "👍", 10_000);
    await bob.screenshot({ path: `${SHOTS}/online-reaction.png` });
  });

  await step("guest switches live to 3D Tabletop; turns stay in sync with a 2D client", async () => {
    const before = await ply(bob);
    await bob.getByTestId("style-button").click();
    const dialog = bob.getByRole("dialog", { name: "Board style" });
    await dialog.getByRole("option", { name: /tabletop/i }).click();
    await dialog.getByRole("button", { name: /use this style/i }).click();
    await bob.keyboard.press("Escape");
    await bob.waitForSelector("[data-testid=board-3d][data-ready='1']", { timeout: 90_000 });
    assert((await ply(bob)) >= before, "style switch lost the game state");
    for (let t = 0; t < 4; t++) {
      await playTurn([alice, bob], 30 + t);
      await assertInSync([alice, bob]);
    }
    await bob.screenshot({ path: `${SHOTS}/web-3d-online-bob.png` });
    await alice.screenshot({ path: `${SHOTS}/web-3d-online-alice-2d.png` });
    // back to Classic for the remaining steps
    await bob.evaluate(() => {
      const k = "carc.settings.v1";
      localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? "{}"), style: "classic", camera: "top-down" }));
    });
  });

  if (!EXTERNAL) {
    await step("FORCE_POLLING: a new game runs over HTTP polling", async () => {
      await startServer({ FORCE_POLLING: "true" });
      const room = await createRoom(alice, { seats: 2, bots: 0, river: false });
      await guestJoin(bob, room, "Bob");
      await startGame(alice, [bob]);
      for (const p of [alice, bob]) await waitAttr(p, "data-connection", "v === a", "polling");
      for (let t = 0; t < 4; t++) {
        await playTurn([alice, bob], t);
        await assertInSync([alice, bob]);
      }
      await alice.screenshot({ path: `${SHOTS}/online-polling.png` });
      await startServer();
    });
  }

  await step("a server bot seat moves (queue consumer, in-process scheduler)", async () => {
    await createRoom(alice, { seats: 2, bots: 1 });
    await alice.locator("[data-seat-kind=bot]").waitFor({ timeout: T });
    await startGame(alice, []);
    for (let t = 0; t < 3; t++) {
      // Wait for my turn (the bot may move first), then move.
      await waitAttr(alice, "data-my-turn", "v === a", "1", T);
      const before = await ply(alice);
      await playTurn([alice], t);
      // The bot answers on its own.
      await waitPly(alice, before + 2, T);
    }
    assert((await ply(alice)) >= 6, "bot did not keep up");
    await alice.screenshot({ path: `${SHOTS}/online-bot.png` });
  });

  const bad = errors.filter((e) => !/hydrat|Download the React DevTools/i.test(e));
  if (bad.length) console.warn(`console errors:\n  ${bad.join("\n  ")}`);
} finally {
  await browser?.close();
  await stopServer();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  for (const f of failed) console.log(`\n✗ ${f.name}\n${f.error}`);
  if (failed.length) process.exitCode = 1;
}
