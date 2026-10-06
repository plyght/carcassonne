// The live hero board: the landing's recorded game, replayed through the real engine
// (core.wasm) one tile every few seconds and rendered by @carcassonne/render-three,
// with the camera drifting slowly around the table. Loaded with a dynamic import
// after first paint, so three.js and the wasm never block the poster.

import { seedFromString } from "@carcassonne/game-client";
import { DEFAULT_RULESET, type GameView, type Move } from "@carcassonne/protocol";
import { BoardRenderer, getStylePack, type Tier } from "@carcassonne/render-three";

import { loadCoreAssets } from "@/lib/core";

import { aimAt, snapTo, type RigLike, type ShotSpec } from "./framing";
import game from "./hero-game.json";
import { landingPack } from "./landing-pack";

export const HERO_START_PLY = 50;
/** Seconds between placements. */
const STEP = 3.6;
/** Seconds the finished board rests before the game starts over. */
const REST = 9;
/** One slow sway of the camera, seconds; and its amplitude, radians. */
const SWAY = 56;
const SWAY_AMP = 0.16;

export interface LiveOptions {
  canvas: HTMLCanvasElement;
  /** Table colour (the panel behind the canvas). */
  table: string;
  spec: ShotSpec;
  tier: Tier;
  onFirstFrame(): void;
  onView(view: GameView): void;
  /** The game is about to restart (fade out, then `restart()`). */
  onRestart(): void;
}

export interface LiveBoard {
  setVisible(on: boolean): void;
  /** Repaint the table (the page colour) after a theme change. */
  setTable(color: string): void;
  restart(): void;
  dispose(): void;
}

export async function startLive(o: LiveOptions): Promise<LiveBoard> {
  const assets = await loadCoreAssets();
  const moves = game.moves as Move[];
  let g = assets.kit.core.createGame(DEFAULT_RULESET, seedFromString(game.seed), game.players);
  const reset = () => {
    g.free();
    g = assets.kit.core.createGame(DEFAULT_RULESET, seedFromString(game.seed), game.players);
    for (const m of moves.slice(0, HERO_START_PLY)) g.apply(m);
  };
  for (const m of moves.slice(0, HERO_START_PLY)) g.apply(m);

  const r = await BoardRenderer.create({
    canvas: o.canvas,
    geo: assets.geo,
    style: landingPack(getStylePack("tabletop"), o.table),
    camera: "tabletop",
    tier: o.tier,
    reducedMotion: false,
    autoRender: false,
    interactive: false,
    pixelRatio: Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 1.75),
  });
  r.setPlayerSlots([0, 1, 2, 3]);
  const rig = r.rig as unknown as RigLike;
  const aspect = () => (o.canvas.clientWidth || 1) / (o.canvas.clientHeight || 1);
  let view = g.view();
  const cells = () => view.board.map((b) => ({ x: b.x, y: b.y }));
  const show = () => {
    view = g.view();
    r.setView(view);
    r.frame();
    snapTo(rig, cells(), aspect(), o.spec, 0);
    o.onView(view);
  };
  show();

  let ply = HERO_START_PLY;
  let t = 0;
  let nextAt = STEP;
  let restAt = Infinity;
  let visible = true;
  let raf = 0;
  let last = 0;
  let frames = 0;
  let disposed = false;

  const tick = (now: number) => {
    raf = 0;
    if (disposed) return;
    // wall-clock time (long gaps, e.g. a background tab, are capped)
    const dt = last ? Math.min(1, (now - last) / 1000) : 0;
    last = now;
    t += dt;
    // a new placement every STEP seconds (never on top of a running animation)
    if (t >= nextAt && !r.animating && restAt === Infinity) {
      const m = moves[ply];
      if (m && g.view().status === "playing") {
        const res = g.apply(m);
        ply++;
        if (res.ok) {
          view = g.view();
          r.pushEvents(res.events, view);
          o.onView(view);
        }
        nextAt = t + STEP;
      } else restAt = t + REST;
    }
    if (t >= restAt) {
      restAt = Infinity;
      o.onRestart();
    }
    if (frames % 8 === 0) aimAt(rig, cells(), aspect(), o.spec, Math.sin((t / SWAY) * Math.PI * 2) * SWAY_AMP);
    r.frame();
    if (++frames === 2) o.onFirstFrame();
    if (visible) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    setVisible(on) {
      if (on === visible || disposed) return;
      visible = on;
      last = 0;
      if (on && !raf) raf = requestAnimationFrame(tick);
    },
    setTable(color) {
      if (disposed) return;
      r.setStyle(landingPack(getStylePack("tabletop"), color));
      r.frame();
    },
    restart() {
      reset();
      ply = HERO_START_PLY;
      r.finishAnimations();
      t = 0;
      nextAt = STEP;
      show();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      g.free();
      r.dispose();
    },
  };
}
