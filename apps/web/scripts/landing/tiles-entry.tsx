// Browser side of `shoot.mjs tiles|classic`: painted Classic tiles as PNG data URLs
// (with their feature anchors), or the landing game drawn by the real 2D ClassicBoard.
import { createRoot } from "react-dom/client";

import { CoreGeo } from "@carcassonne/core-geo";
import { catalogFromKit, loadCoreKit } from "@carcassonne/game-client";
import { DEFAULT_RULESET, type Move } from "@carcassonne/protocol";
import {
  ClassicBoard,
  createGeoArt,
  createGeoFigures,
  ctx2d,
  getStyle,
  illustratedFromGeo,
  installArt,
  makeCanvas,
  paintTile,
} from "@carcassonne/render-classic";

declare global {
  interface Window {
    __poster?: { ready: boolean; error?: string; moves?: Move[]; tiles?: Record<string, string>; anchors?: Record<string, { kind: string; anchor: [number, number] }[]> };
    LANDING?: { seed: string; players: number; moves: Move[] };
  }
}

const q = new URLSearchParams(location.search);
window.__poster = { ready: false };

async function main() {
  const kit = await loadCoreKit(new URL("/core.wasm", location.href));
  const geo = new CoreGeo(kit.instance);
  const catalog = catalogFromKit(kit);
  const classic = getStyle("classic");

  if (q.get("mode") === "classic") {
    const art = createGeoArt(geo);
    const figures = createGeoFigures(geo);
    installArt({ tiles: art, figures });
    const cfg = window.LANDING!;
    const game = kit.core.createGame(DEFAULT_RULESET, BigInt(cfg.seed), cfg.players);
    for (const m of cfg.moves.slice(0, Number(q.get("ply") ?? 50))) game.apply(m);
    const view = game.view();
    document.body.style.background = classic.palette!.table;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    createRoot(host).render(
      <ClassicBoard
        view={view}
        catalog={catalog}
        art={art}
        figures={figures}
        palette={classic.palette!}
        players={[{ color: "red" }, { color: "blue" }, { color: "yellow" }, { color: "green" }]}
        interactive={false}
        controls={false}
        reducedMotion
        ariaLabel="board"
      />,
    );
    // painted tiles arrive over a few frames
    await new Promise((r) => setTimeout(r, Number(q.get("wait") ?? 6000)));
    window.__poster = { ready: true };
    return;
  }

  // tiles=E:0,D:0 → one PNG per tile/rotation
  const size = Number(q.get("size") ?? 384);
  const pal = classic.palette!.illustrated!;
  const tiles: Record<string, string> = {};
  const anchors: Record<string, { kind: string; anchor: [number, number] }[]> = {};
  for (const spec of (q.get("tiles") ?? "D:0").split(",")) {
    const [id, rot] = spec.split(":") as [string, string];
    const g = geo.tile2d(id);
    const ill = illustratedFromGeo(g, geo.tile3d(id, 2).props);
    const c = makeCanvas(size, size) as HTMLCanvasElement;
    paintTile(ctx2d(c), { tile: ill, rot: Number(rot), palette: pal, paletteId: "classic", size });
    tiles[`${id}${rot}`] = c.toDataURL("image/png");
    anchors[id] = g.features.map((f) => ({ kind: f.kind, anchor: [f.anchor[0], f.anchor[1]] }));
  }
  window.__poster = { ready: true, tiles, anchors };
}

main().catch((e) => {
  console.error(e);
  window.__poster = { ready: true, error: String(e?.stack ?? e) };
});
