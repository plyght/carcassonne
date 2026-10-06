// Browser side of scripts/illustrated-sheet.ts: paints the tiles in window.SHEET.
import { paintTile } from "../src/illustrated/paint";
import { makeCanvas, ctx2d } from "../src/illustrated/types";
import type { IllustratedTile } from "../src/illustrated/types";
import { CLASSIC_PALETTE } from "../src/palette";

interface Sheet {
  tiles: IllustratedTile[];
  size: number;
  rots: number[];
  /** Optional assembled boards: rows of [tileIndex, rot] (or null for a gap). */
  boards?: { title: string; cells: ([number, number] | null)[][] }[];
}

const sheet = (window as unknown as { SHEET: Sheet }).SHEET;
const pal = CLASSIC_PALETTE.illustrated!;
const root = document.getElementById("root")!;
const t0 = performance.now();
let painted = 0;

function tileCanvas(t: IllustratedTile, rot: number, size: number) {
  const c = makeCanvas(size, size) as HTMLCanvasElement;
  paintTile(ctx2d(c), { tile: t, rot, palette: pal, paletteId: "classic", size });
  painted++;
  c.style.width = `${size / devicePixelRatio}px`;
  c.style.height = `${size / devicePixelRatio}px`;
  c.style.display = "block";
  return c;
}

const grid = document.createElement("div");
grid.className = "grid";
root.appendChild(grid);
for (const t of sheet.tiles) {
  for (const rot of sheet.rots) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.appendChild(tileCanvas(t, rot, sheet.size));
    const label = document.createElement("div");
    label.textContent = sheet.rots.length > 1 ? `${t.id} r${rot}` : t.id;
    cell.appendChild(label);
    grid.appendChild(cell);
  }
}
for (const b of sheet.boards ?? []) {
  const h = document.createElement("h2");
  h.textContent = b.title;
  root.appendChild(h);
  const table = document.createElement("div");
  table.className = "board";
  for (const row of b.cells) {
    const r = document.createElement("div");
    r.style.display = "flex";
    for (const cell of row) {
      if (!cell) {
        const gap = document.createElement("div");
        gap.style.width = gap.style.height = `${sheet.size / devicePixelRatio}px`;
        r.appendChild(gap);
      } else r.appendChild(tileCanvas(sheet.tiles[cell[0]]!, cell[1], sheet.size));
    }
    table.appendChild(r);
  }
  root.appendChild(table);
}
const info = document.createElement("p");
info.textContent = `${painted} tiles painted in ${(performance.now() - t0).toFixed(0)} ms at ${sheet.size}px (incl. textures)`;
root.appendChild(info);
document.body.dataset.done = "1";
