// Tuning hooks for the 2D board palettes (Classic, Blueprint). A palette is data, so
// live tuning is "merge a patch over the shipped palette" and exporting is printing
// the result as the TS literal that lives in ./palette.ts.

import type { BoardPalette } from "./palette";

export type PalettePatch = { [K in keyof BoardPalette]?: BoardPalette[K] extends object | undefined ? Record<string, unknown> : BoardPalette[K] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isObj(patch) || !isObj(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}

/**
 * `base` with `patch` merged in. The id gets a revision suffix so cached painted tile
 * bitmaps (keyed by palette id) repaint with the new colours.
 */
export function tunePalette(base: BoardPalette, patch: Record<string, unknown>, revision: number): BoardPalette {
  const out = merge(base, patch) as BoardPalette;
  return { ...out, id: `${base.id}~tune${revision}` };
}

/** The palette as a TS literal (paste over the constant in palette.ts). */
export function paletteSource(palette: BoardPalette, constName: string): string {
  const { id, ...rest } = palette;
  const body = JSON.stringify({ id: id.replace(/~tune\d+$/, ""), ...rest }, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");
  return `export const ${constName}: BoardPalette = ${body};\n`;
}
