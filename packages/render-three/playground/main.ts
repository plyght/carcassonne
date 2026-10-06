// Playground: a seeded game played with random legal moves through the real
// engine (core.wasm), rendered by BoardRenderer with style / camera / tier
// switchers. Query params:
//   seed, moves (fast-forward without animation), style, camera, tier,
//   backend (auto|webgpu|webgl), capture=1 (manual clock, no UI), reduced=1
import { CoreGeo } from "@carcassonne/core-geo";
import { loadCore, type EngineGame } from "@carcassonne/core-wasm";
import { DEFAULT_RULESET, type FigureOption, type GameView, type Move, type Placement } from "@carcassonne/protocol";
import { BoardRenderer, CAMERA_MODES, ManualClock, STYLE_IDS, type CameraMode, type Tier } from "../src";

const q = new URLSearchParams(location.search);
const capture = q.get("capture") === "1";
if (capture) document.body.classList.add("capture");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wasmUrl = new URL("/core.wasm", location.href);
const bytes = await (await fetch(wasmUrl)).arrayBuffer();
const core = await loadCore(bytes);
const geo = await CoreGeo.instantiate(bytes);

const clock = capture ? new ManualClock() : undefined;
const canvas = document.getElementById("board") as HTMLCanvasElement;
const renderer = await BoardRenderer.create({
  canvas,
  geo,
  style: q.get("style") ?? "tabletop",
  camera: (q.get("camera") as CameraMode) ?? "tabletop",
  tier: (q.get("tier") as Tier) ?? "auto",
  backend: (q.get("backend") as "auto" | "webgpu" | "webgl") ?? "auto",
  reducedMotion: q.get("reduced") === "1",
  clock,
  autoRender: !capture,
  pixelRatio: capture ? 1 : undefined,
});

let game: EngineGame;
let rand: () => number;
let view: GameView;

function chooseMove(g: EngineGame): Move | null {
  const ps = g.legalPlacements();
  if (ps.length === 0) return null;
  const p = ps[Math.floor(rand() * ps.length)]!;
  const figs = g.legalFigures(p);
  const fig = figs.length > 0 && rand() < 0.45 ? figs[Math.floor(rand() * figs.length)]! : null;
  return { ...p, figure: fig ? { type: fig.type, feature: fig.feature } : null };
}

const showHints = q.get("hints") ? q.get("hints") === "1" : !capture;
function updateHints(): void {
  if (!showHints) return renderer.setPlacementHints(null);
  if (view.status !== "playing" || !view.currentTile) return renderer.setPlacementHints(null);
  renderer.setPlacementHints({ tile: view.currentTile, placements: game.legalPlacements() });
}

/** Apply one move. `animate` plays the event timeline. */
function play(move: Move | null, animate: boolean): boolean {
  if (!move || view.status !== "playing") return false;
  const res = game.apply(move);
  if (!res.ok) {
    console.warn("illegal", res.error);
    return false;
  }
  view = game.view();
  if (animate) renderer.pushEvents(res.events, view);
  else renderer.setView(view);
  updateHints();
  return true;
}

function newGame(seed: number, fastForward: number): void {
  game?.free();
  rand = mulberry32(seed * 7919 + 1);
  game = core.createGame(DEFAULT_RULESET, BigInt(seed), 4);
  view = game.view();
  for (let i = 0; i < fastForward; i++) if (!play(chooseMove(game), false)) break;
  view = game.view();
  renderer.setView(view);
  renderer.setPendingPlacement(null);
  updateHints();
}

const seed = Number(q.get("seed") ?? 7);
newGame(seed, Number(q.get("moves") ?? 30));
if (q.get("zoom")) renderer.rig.zoom(Number(q.get("zoom")));
// look=cx,cz,extent: hold a cinematic focus (close-ups for comparisons)
if (q.get("look")) {
  const [cx, cz, ext] = q.get("look")!.split(",").map(Number);
  renderer.rig.hint(cx ?? 0, cz ?? 0, ext ?? 1.5, 1, 1e9);
}
if (q.get("yaw")) renderer.rig.yawOffset = Number(q.get("yaw"));

// --- UI --------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const styleSel = $<HTMLSelectElement>("style");
for (const s of STYLE_IDS) styleSel.add(new Option(s, s, false, s === renderer.styleId));
styleSel.onchange = () => renderer.setStyle(styleSel.value);
const camSel = $<HTMLSelectElement>("camera");
for (const c of CAMERA_MODES) camSel.add(new Option(c, c, false, c === renderer.cameraMode));
camSel.onchange = () => renderer.setCamera(camSel.value as CameraMode);
const tierSel = $<HTMLSelectElement>("tier");
tierSel.value = renderer.stats().tier;
tierSel.onchange = () => renderer.setTier(tierSel.value as Tier);
$<HTMLInputElement>("reduced").checked = q.get("reduced") === "1";
$<HTMLInputElement>("reduced").onchange = (e) => renderer.setReducedMotion((e.target as HTMLInputElement).checked);
$<HTMLInputElement>("seed").value = String(seed);
$("restart").onclick = () => newGame(Number($<HTMLInputElement>("seed").value), 0);
$("step").onclick = () => play(chooseMove(game), true);
let auto: ReturnType<typeof setInterval> | null = null;
$("auto").onclick = () => {
  if (auto) {
    clearInterval(auto);
    auto = null;
    return;
  }
  auto = setInterval(() => {
    if (!renderer.animating && !play(chooseMove(game), true) && auto) clearInterval(auto);
  }, 250);
};
$("rotate").onclick = () => renderer.rotateGhost(1);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "r" || e.key === "R") renderer.rotateGhost(1);
  if (e.key === "Escape") renderer.setPendingPlacement(null);
});

// Human play through picking: click a legal cell to place the ghost, then
// click a highlighted feature to put a meeple there (or the tile again to skip).
let pending: { p: Placement; options: FigureOption[] } | null = null;
renderer.on((e) => {
  if (e.type !== "click") return;
  if (pending) {
    const { p, options } = pending;
    const onTile = e.pick.cell.x === p.x && e.pick.cell.y === p.y;
    if (!onTile) {
      pending = null;
      renderer.setPendingPlacement(null);
      return;
    }
    const opt = options.find((o) => o.feature === e.pick.feature);
    pending = null;
    renderer.setPendingPlacement(null);
    play({ ...p, figure: opt ? { type: opt.type, feature: opt.feature } : null }, true);
    return;
  }
  if (e.placement) {
    pending = { p: e.placement, options: game.legalFigures(e.placement) };
    renderer.setPendingPlacement(e.placement, pending.options);
  }
});

const statsEl = $("stats");
if (!capture)
  setInterval(() => {
    const s = renderer.stats();
    statsEl.textContent = `${s.backend} · ${s.style} · ${s.camera} · ${s.tier}\ntiles ${s.tiles} · figures ${s.figures} · draws ${s.drawCalls} · tris ${s.triangles}\nframe ${s.frameMs.toFixed(1)} ms · interval ${s.intervalMs.toFixed(1)} ms · cache ${s.meshCache.size}`;
  }, 500);

// --- capture hooks (Playwright) -----------------------------------------------
(window as unknown as Record<string, unknown>).__pg = {
  renderer,
  get view() {
    return view;
  },
  step: (animate = true) => play(chooseMove(game), animate),
  /** Advance the manual clock by `seconds` in `steps` frames and render. */
  advance(seconds: number, steps = 1) {
    for (let i = 0; i < steps; i++) {
      clock?.tick(seconds / steps);
      renderer.frame();
    }
  },
  async frames(n: number) {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      clock?.tick(1 / 60);
      renderer.frame();
      await renderer.settle();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(n / 2)], min: times[0], max: times[n - 1], stats: renderer.stats() };
  },
  /** Fast-forward (no animation) until a move scores a feature, then animate that move. */
  stepUntilScore(max = 60) {
    for (let i = 0; i < max && view.status === "playing"; i++) {
      const move = chooseMove(game);
      if (!move) return false;
      const res = game.apply(move);
      if (!res.ok) return false;
      view = game.view();
      if (res.events.some((e) => e.type === "featureScored")) {
        renderer.pushEvents(res.events, view);
        updateHints();
        return res.events.map((e) => e.type);
      }
      renderer.setView(view);
    }
    return false;
  },
  playAll(animate = false) {
    let n = 0;
    while (play(chooseMove(game), animate)) n++;
    return n;
  },
  ready: true,
};
