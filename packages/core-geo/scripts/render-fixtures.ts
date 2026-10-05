// Renders every registry tile (2D geo) to an SVG contact sheet, plus small
// assembled boards to eyeball edge alignment.
//   cd packages/core && zig build wasm
//   bun packages/core-geo/scripts/render-fixtures.ts [out.svg] [core.wasm]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo, svgPathData, type GeoTile2D } from "../src";

const here = import.meta.dir;
const out = resolve(process.argv[2] ?? resolve(here, "../../../docs/research/geo-fixtures.svg"));
const wasmPath = resolve(process.argv[3] ?? resolve(here, "../../core/zig-out/bin/core.wasm"));

const geo = await CoreGeo.instantiate(readFileSync(wasmPath));
const ids = geo.tileIds();

const S = 180; // tile size in px
const PAD = 26;
const COLS = 6;

const C = {
  field: ["#a9c96f", "#9cc063", "#b4cf7c", "#93b95c", "#a2c46a", "#b9d385", "#8fb458", "#aecb75"],
  city: "#c8a777",
  cityEdge: "#7d5a35",
  road: "#f3ead3",
  roadEdge: "#8a7a5c",
  river: "#5ea9da",
  plaza: "#e6dcc0",
  cloister: "#b5543f",
  garden: "#5f9e4a",
  anchor: "#202020",
};

function tileSvg(g: GeoTile2D, x: number, y: number, rot = 0, debug = true): string {
  const parts: string[] = [];
  const t = `translate(${x} ${y}) rotate(${rot * 90} ${S / 2} ${S / 2})`;
  parts.push(`<g transform="${t}">`);
  parts.push(`<rect width="${S}" height="${S}" fill="#ddd"/>`);
  for (const p of g.paths) {
    const d = svgPathData(p.points, p.closed, S);
    if (p.role === "region") {
      if (p.kind === "field") parts.push(`<path d="${d}" fill="${C.field[p.feature % C.field.length]}" stroke="#6f8f3c" stroke-width="0.6"/>`);
      else if (p.kind === "city") parts.push(`<path d="${d}" fill="${C.city}"/>`);
      else if (p.kind === "road") parts.push(`<path d="${d}" fill="${C.road}" stroke="${C.roadEdge}" stroke-width="0.8"/>`);
      else if (p.kind === "river") parts.push(`<path d="${d}" fill="${C.river}"/>`);
    } else if (p.role === "centerline" && p.kind === "road") {
      parts.push(`<path d="${d}" fill="none" stroke="${C.roadEdge}" stroke-width="0.7" stroke-dasharray="3 4"/>`);
    } else if (p.role === "plaza") {
      parts.push(`<path d="${d}" fill="${C.plaza}" stroke="${C.roadEdge}" stroke-width="0.8"/>`);
    } else if (p.role === "wall") {
      parts.push(`<path d="${d}" fill="none" stroke="${C.cityEdge}" stroke-width="${p.width * S}" stroke-linecap="butt"/>`);
    } else if (p.role === "building") {
      parts.push(`<path d="${d}" fill="${p.kind === "garden" ? C.garden : C.cloister}" stroke="#3a2a20" stroke-width="1"/>`);
    }
  }
  for (const pn of g.pennants) {
    const px = pn.x * S;
    const py = pn.y * S;
    parts.push(
      `<path d="M${px - 7} ${py - 8}h14v7q0 7-7 10q-7-3-7-10z" fill="#2c5aa0" stroke="#fff" stroke-width="1.2"/>`,
    );
  }
  if (debug) {
    for (const f of g.features) {
      const [ax, ay] = f.anchor;
      parts.push(`<circle cx="${ax * S}" cy="${ay * S}" r="4" fill="${C.anchor}" stroke="#fff" stroke-width="1.2"/>`);
      parts.push(`<text x="${ax * S + 6}" y="${ay * S - 4}" font-size="9" font-family="monospace" fill="#000">${f.index}</text>`);
    }
    // port ticks
    for (let k = 1; k < 3; k++) {
      const o = (k * S) / 3;
      parts.push(
        `<path d="M${o} 0v4M${o} ${S}v-4M0 ${o}h4M${S} ${o}h-4" stroke="#0006" stroke-width="1"/>`,
      );
    }
  }
  parts.push(`<rect width="${S}" height="${S}" fill="none" stroke="#0004" stroke-width="1"/>`);
  parts.push("</g>");
  return parts.join("");
}

const tiles = ids.map((id) => geo.tile2d(id));
const rows = Math.ceil(tiles.length / COLS);
const sheetW = COLS * (S + PAD) + PAD;

const parts: string[] = [];
let y0 = PAD;
parts.push(`<text x="${PAD}" y="${y0 - 8}" font-size="14" font-family="sans-serif">core/geo fixtures (canonical rot 0; dots = meeple anchors, numbers = feature index)</text>`);
tiles.forEach((g, i) => {
  const x = PAD + (i % COLS) * (S + PAD);
  const y = y0 + Math.floor(i / COLS) * (S + PAD + 14);
  parts.push(tileSvg(g, x, y));
  parts.push(`<text x="${x}" y="${y + S + 13}" font-size="11" font-family="monospace">${g.meta.id} (${g.features.map((f) => f.kind[0]).join("")})</text>`);
});
y0 += rows * (S + PAD + 14) + 20;

// Assembled boards: [id, rot, col, row]
const boards: { title: string; cells: [string, number, number, number][] }[] = [
  {
    title: "edge alignment: roads",
    cells: [
      ["fx-cap-road-straight", 0, 0, 0],
      ["fx-crossroads4", 0, 1, 0],
      ["fx-road-straight", 1, 2, 0],
      ["fx-cap-crossroads", 0, 3, 0],
      ["fx-road-curve", 2, 4, 0],
      ["fx-crossroads3", 3, 1, 1],
      ["fx-road-straight", 0, 3, 1],
      ["fx-cloister-road", 2, 4, 1],
      ["fx-city3-road", 2, 1, 2],
      ["fx-corner-road", 1, 3, 2],
    ],
  },
  {
    title: "edge alignment: cities + river",
    cells: [
      ["fx-cap", 2, 1, 0],
      ["fx-cap", 3, 2, 1],
      ["fx-city4", 0, 1, 1],
      ["fx-cap", 1, 0, 1],
      ["fx-city-band", 0, 1, 2],
      ["fx-river-spring", 2, 3, 0],
      ["fx-river-straight", 0, 3, 1],
      ["fx-river-bridge", 0, 3, 2],
      ["fx-river-curve", 2, 4, 2],
      ["fx-river-lake", 3, 4, 3],
      ["fx-corner-pennant", 0, 0, 2],
      ["fx-caps-adjacent", 3, 2, 3],
    ],
  },
];
for (const b of boards) {
  parts.push(`<text x="${PAD}" y="${y0 - 6}" font-size="14" font-family="sans-serif">${b.title}</text>`);
  let maxRow = 0;
  for (const [id, rot, cx, cy] of b.cells) {
    parts.push(tileSvg(geo.tile2d(id), PAD + cx * S, y0 + cy * S, rot, false));
    maxRow = Math.max(maxRow, cy);
  }
  y0 += (maxRow + 1) * S + 40;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${y0}" viewBox="0 0 ${sheetW} ${y0}"><rect width="100%" height="100%" fill="#f7f4ec"/>${parts.join("")}</svg>\n`;
writeFileSync(out, svg);
console.log(`wrote ${out} (${tiles.length} tiles)`);
