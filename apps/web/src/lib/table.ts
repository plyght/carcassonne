// The table under the 2D board comes from the app's tokens (--game-table in tokens.css),
// so it follows light and dark mode and matches the HUD. Only the painted Classic
// board takes it; other 2D styles (Blueprint) keep their own table, and the 3D styles
// draw theirs in render-three.

import type { BoardPalette } from "@carcassonne/render-classic";

const cache = new WeakMap<BoardPalette, BoardPalette>();

export function withAppTable(palette: BoardPalette): BoardPalette {
  if (palette.id !== "classic") return palette;
  let out = cache.get(palette);
  if (!out) {
    out = { ...palette, table: "var(--game-table)" };
    cache.set(palette, out);
  }
  return out;
}
