// The landing board sits on the page itself: the 3D style's backdrop and table take the
// page colour, so the canvas has no visible edge in light or dark.

import type { StylePack } from "@carcassonne/render-three/styles";

/** Any CSS colour (oklch, var-resolved) as #rrggbb, via a 1×1 canvas. */
export function cssColorToHex(color: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  if (!g) return "#f3eadb";
  g.fillStyle = "#000";
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return `#${[r, gg, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

/** `base` with the page colour as backdrop and table. */
export function landingPack(base: StylePack, pageColor: string): StylePack {
  const hex = pageColor.startsWith("#") ? pageColor : cssColorToHex(pageColor);
  return { ...base, id: `${base.id}`, palette: { ...base.palette, background: hex, table: hex } };
}
