// Dev aid: `bun scripts/tile-sheet.tsx > sheet.html` renders every tile in both 2D palettes.
import { renderToStaticMarkup } from "react-dom/server";

import { BASE_TILES } from "@carcassonne/game-client/dev-engine";

import { BLUEPRINT_PALETTE, CLASSIC_PALETTE } from "../src/palette";
import { proceduralArt } from "../src/procedural-art";
import { TileThumb } from "../src/tile";

const html = renderToStaticMarkup(
  <html>
    <body style={{ margin: 0, background: "#444", fontFamily: "sans-serif" }}>
      {[CLASSIC_PALETTE, BLUEPRINT_PALETTE].map((p) => (
        <div key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8, background: p.table }}>
          {BASE_TILES.map((d) => (
            <div key={d.id} style={{ textAlign: "center", color: "#fff", fontSize: 12 }}>
              <TileThumb def={d} art={proceduralArt} palette={p} size={110} />
              <div>{d.id}</div>
            </div>
          ))}
        </div>
      ))}
    </body>
  </html>,
);
console.log(`<!doctype html>${html}`);
