// Helpers to turn decoded geo into SVG / Canvas paths, and to place tiles.

/** SVG path `d` for interleaved x,y points, scaled by `scale`. */
export function svgPathData(points: Float32Array | number[], closed: boolean, scale = 1, dx = 0, dy = 0): string {
  let d = "";
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = (points[i] ?? 0) * scale + dx;
    const y = (points[i + 1] ?? 0) * scale + dy;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return closed ? `${d}Z` : d;
}

/** Canvas Path2D for interleaved x,y points (browser only). */
export function canvasPath(points: Float32Array, closed: boolean): Path2D {
  const p = new Path2D();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  if (closed) p.closePath();
  return p;
}

/**
 * Rotate a canonical tile-space point by `rot` clockwise quarter turns about
 * the tile centre (screen coords, y down) — the same rule the engine uses
 * for ports. For 3D, apply it to (x, z) or rotate the mesh by -rot*PI/2 about +y.
 */
export function rotatePoint(x: number, y: number, rot: number): [number, number] {
  let px = x;
  let py = y;
  for (let i = 0; i < (((rot % 4) + 4) % 4); i++) {
    const t = px;
    px = 1 - py;
    py = t;
  }
  return [px, py];
}
