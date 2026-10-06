// Browser side of scripts/landing/shoot.mjs: replays the landing's seeded game through
// core.wasm and renders one frame with BoardRenderer on a manual clock, framed exactly
// like the live hero (src/components/landing/framing.ts).
//   ?gen=1                         play a whole game with Medium bots, expose the moves
//   ?ply=34&style=tabletop&shot=wide&bg=<css colour>&tier=high
import { CoreGeo } from "@carcassonne/core-geo";
import { loadCore } from "@carcassonne/core-wasm";
import { DEFAULT_RULESET, type GameView, type Move } from "@carcassonne/protocol";
import { BoardRenderer, getStylePack, ManualClock, type Tier } from "@carcassonne/render-three";

import { HERO_NARROW, HERO_WIDE, SHOWCASE, snapTo, type RigLike } from "../../src/components/landing/framing";
import { landingPack } from "../../src/components/landing/landing-pack";

declare global {
  interface Window {
    __poster?: { ready: boolean; error?: string; moves?: Move[]; tiles?: Record<string, string>; anchors?: Record<string, { kind: string; anchor: [number, number] }[]> };
    LANDING?: { seed: string; players: number; moves: Move[] };
  }
}

const q = new URLSearchParams(location.search);
window.__poster = { ready: false };

async function main() {
  const bytes = await (await fetch("/core.wasm")).arrayBuffer();
  const core = await loadCore(bytes);
  const cfg = window.LANDING!;
  const game = core.createGame(DEFAULT_RULESET, BigInt(cfg.seed), cfg.players);

  if (q.get("gen") === "1") {
    const moves: Move[] = [];
    for (let i = 0; i < 200 && game.view().status === "playing"; i++) {
      const m = game.aiChoose("medium", 400, BigInt(1000 + i));
      if (!m) break;
      const r = game.apply(m);
      if (!r.ok) throw new Error(r.error);
      moves.push(m);
    }
    window.__poster = { ready: true, moves };
    return;
  }

  const ply = Number(q.get("ply") ?? cfg.moves.length);
  for (const m of cfg.moves.slice(0, ply)) {
    const r = game.apply(m);
    if (!r.ok) throw new Error(r.error);
  }
  const geo = await CoreGeo.instantiate(bytes);
  const clock = new ManualClock();
  const canvas = document.getElementById("board") as HTMLCanvasElement;
  const r = await BoardRenderer.create({
    canvas,
    geo,
    style: q.get("style") ?? "tabletop",
    camera: "tabletop",
    tier: (q.get("tier") as Tier) ?? "high",
    backend: "webgl",
    clock,
    autoRender: false,
    pixelRatio: 1,
  });
  const bg = q.get("bg");
  const base = getStylePack(q.get("style") ?? "tabletop");
  r.setStyle(bg ? landingPack(base, bg) : base);
  r.setPlayerSlots([0, 1, 2, 3]);
  // solo=D&f=0: one tile with a meeple on feature f (the dithered signature)
  const solo = q.get("solo");
  const view = solo
    ? ({ ...game.view(), board: [{ x: 0, y: 0, rot: 0, tile: solo, figures: [{ player: Number(q.get("p") ?? 0), feature: Number(q.get("f") ?? 0), figure: "meeple" }] }] } as GameView)
    : game.view();
  r.setView(view);
  const base0 = { wide: HERO_WIDE, narrow: HERO_NARROW, showcase: SHOWCASE }[q.get("shot") ?? "wide"] ?? HERO_WIDE;
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  // overrides for exploring a framing before it goes into framing.ts
  const spec = {
    yaw: num("yaw", base0.yaw),
    pitch: num("pitch", base0.pitch),
    fov: num("fov", base0.fov),
    fill: num("fill", base0.fill),
    insets: {
      top: num("it", base0.insets.top),
      right: num("ir", base0.insets.right),
      bottom: num("ib", base0.insets.bottom),
      left: num("il", base0.insets.left),
    },
  };
  // settle bounds, then frame
  clock.tick(0.016);
  r.frame();
  const cells = view.board.map((b) => ({ x: b.x, y: b.y }));
  snapTo(r.rig as unknown as RigLike, cells, innerWidth / innerHeight, spec, Number(q.get("drift") ?? 0));
  for (let i = 0; i < 6; i++) {
    clock.tick(1 / 30);
    r.frame();
  }
  await r.settle();
  window.__poster = { ready: true };
}

main().catch((e) => {
  console.error(e);
  window.__poster = { ready: true, error: String(e?.stack ?? e) };
});
