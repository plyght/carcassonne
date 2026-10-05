// Dev aid: `bun scripts/tile-sheet.tsx > sheet.html` renders every engine tile in both 2D
// palettes, core-geo art next to the old procedural art, plus a few meeples.
import { renderToStaticMarkup } from "react-dom/server";

import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";
import { catalogFromKit } from "@carcassonne/game-client/engine";

import { FigureIcon, proceduralFigures } from "../src/figures";
import { createGeoArt, createGeoFigures } from "../src/geo-art";
import { BLUEPRINT_PALETTE, CLASSIC_PALETTE, PLAYER_COLORS } from "../src/palette";
import { proceduralArt } from "../src/procedural-art";
import { TileThumb } from "../src/tile";

const kit = await loadCoreKit();
const geo = new CoreGeo(kit.instance);
const tiles = catalogFromKit(kit).all();
const geoArt = createGeoArt(geo);
const geoFigures = createGeoFigures(geo);
const only = process.argv.includes("--geo-only");

const html = renderToStaticMarkup(
  <html>
    <body style={{ margin: 0, background: "#444", fontFamily: "sans-serif" }}>
      {[CLASSIC_PALETTE, BLUEPRINT_PALETTE].map((p) => (
        <div key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8, background: p.table }}>
          {tiles.map((d) => (
            <div key={d.id} style={{ textAlign: "center", color: "#fff", fontSize: 12 }}>
              <TileThumb def={d} art={geoArt} palette={p} size={110} />
              {only ? null : <TileThumb def={d} art={proceduralArt} palette={p} size={110} />}
              <div>{d.id}</div>
            </div>
          ))}
          {(["meeple", "abbot"] as const).map((k) =>
            [geoFigures, proceduralFigures].map((f) => (
              <FigureIcon key={`${k}${f.name}`} kind={k} figures={f} size={56} fill={PLAYER_COLORS.blue.fill} ink={PLAYER_COLORS.blue.ink} marker="square" />
            )),
          )}
        </div>
      ))}
    </body>
  </html>,
);
console.log(`<!doctype html>${html}`);
