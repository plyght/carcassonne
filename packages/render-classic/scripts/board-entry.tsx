// Browser side of scripts/board-shots.ts: the real ClassicBoard on core.wasm art.
import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";

import type { BoardTile } from "@carcassonne/protocol";
import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";
import { catalogFromKit } from "@carcassonne/game-client/engine";

import { ClassicBoard, type BoardCommands } from "../src/board";
import { createGeoArt, createGeoFigures } from "../src/geo-art";
import { installArt } from "../src/defaults";
import { tileCacheStats } from "../src/illustrated/cache";
import { BLUEPRINT_PALETTE, CLASSIC_PALETTE } from "../src/palette";

interface Harness {
  board: BoardTile[];
  zoom?: number;
  /** Cell to centre after fitting. */
  focus?: [number, number];
  /** Board scale for `focus`. */
  scale?: number;
  blueprint?: boolean;
  /** Classic colours, vector art (baseline for perf comparisons). */
  vector?: boolean;
}

const H = (window as unknown as { HARNESS: Harness }).HARNESS;
const bytes = await (await fetch("/core.wasm")).arrayBuffer();
const kit = await loadCoreKit(bytes);
const geo = new CoreGeo(kit.instance);
const catalog = catalogFromKit(kit);
const art = createGeoArt(geo);
const figures = createGeoFigures(geo);
installArt({ tiles: art, figures });

const PLAYERS = [{ color: "red" as const }, { color: "blue" as const }, { color: "yellow" as const }, { color: "green" as const }];

function App() {
  const cmd = useRef<BoardCommands | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (H.zoom && !H.focus) cmd.current?.zoom(H.zoom);
      if (H.focus) cmd.current?.focus({ x: H.focus[0], y: H.focus[1] }, H.scale);
    }, 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ClassicBoard
        view={{ board: H.board }}
        catalog={catalog}
        palette={H.blueprint ? BLUEPRINT_PALETTE : H.vector ? { ...CLASSIC_PALETTE, illustrated: undefined } : CLASSIC_PALETTE}
        players={PLAYERS}
        art={art}
        figures={figures}
        interactive
        commandsRef={cmd}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
(window as unknown as { STATS: typeof tileCacheStats }).STATS = tileCacheStats;
