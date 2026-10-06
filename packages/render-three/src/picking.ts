// Pure picking math (no three.js): ray vs table plane, board cell, tile-local
// canonical coordinates, the per-vertex feature-id lookup, and the feature
// extent flood fill across the board via edge ports (engine/tile.zig).
//
// World space: x = board x (east), z = board y (south), y = up. Cell (x, y)
// spans [x, x+1] x [y, y+1] in world x/z, matching the anim "point" target.

export type Vec3 = [number, number, number];

/** Intersection of a ray with the horizontal plane y = h, or null when parallel / behind. */
export function rayPlaneY(origin: Vec3, dir: Vec3, h = 0): Vec3 | null {
  if (Math.abs(dir[1]) < 1e-9) return null;
  const t = (h - origin[1]) / dir[1];
  if (t < 0) return null;
  return [origin[0] + dir[0] * t, h, origin[2] + dir[2] * t];
}

/** Board cell containing a world point. */
export function cellAt(wx: number, wz: number): { x: number; y: number } {
  return { x: Math.floor(wx), y: Math.floor(wz) };
}

/**
 * Rotate a canonical tile-space point (x east, y/z south, 0..1) by `rot`
 * clockwise quarter turns about the centre, as seen from above. Same rule as
 * `rotatePoint` in @carcassonne/core-geo.
 */
export function rotateCanonical(x: number, y: number, rot: number): [number, number] {
  let px = x;
  let py = y;
  const r = ((rot % 4) + 4) % 4;
  for (let i = 0; i < r; i++) {
    const t = px;
    px = 1 - py;
    py = t;
  }
  return [px, py];
}

/** Inverse of `rotateCanonical`: placed (rotated) tile-local point back to canonical space. */
export function toCanonical(lx: number, ly: number, rot: number): [number, number] {
  return rotateCanonical(lx, ly, 4 - (((rot % 4) + 4) % 4));
}

export const NO_FEATURE = 255;

/**
 * Feature under a canonical tile point, from the terrain grid's per-vertex
 * feature ids (the first (R+1)^2 vertices of a CGEO 3D buffer, row-major in z).
 * Searches outward a few rings when the nearest vertex has no feature (junction
 * plazas, the gap between bands).
 */
export function featureAtGrid(featureIds: ArrayLike<number>, resolution: number, u: number, v: number, maxRing = 3): number {
  const R = resolution;
  const ci = Math.max(0, Math.min(R, Math.round(u * R)));
  const cj = Math.max(0, Math.min(R, Math.round(v * R)));
  for (let ring = 0; ring <= maxRing; ring++) {
    let best = NO_FEATURE;
    let bestD = Infinity;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i > R || j > R) continue;
        const f = featureIds[j * (R + 1) + i] ?? NO_FEATURE;
        if (f === NO_FEATURE) continue;
        const d = (i / R - u) ** 2 + (j / R - v) ** 2;
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    if (best !== NO_FEATURE) return best;
  }
  return NO_FEATURE;
}

/**
 * Feature hit test on a placed tile: prefer a figure anchor within
 * `anchorRadius` (cloister buildings, small city caps), else the terrain grid.
 * `lx, lz` are tile-local *placed* coordinates (0..1); anchors are canonical.
 */
export function featureAt(
  tile: { featureIds: ArrayLike<number>; resolution: number; anchors: { x: number; z: number }[] },
  rot: number,
  lx: number,
  lz: number,
  anchorRadius = 0.07,
): number {
  const [u, v] = toCanonical(lx, lz, rot);
  let best = -1;
  let bestD = anchorRadius * anchorRadius;
  tile.anchors.forEach((a, i) => {
    const d = (a.x - u) ** 2 + (a.z - v) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best >= 0) return best;
  return featureAtGrid(tile.featureIds, tile.resolution, u, v);
}

// ---------------------------------------------------------------------------
// Feature extent across the board

/** Rotate a 12-bit port mask by `rot` clockwise quarter turns (engine/tile.zig `rotatePorts`). */
export function rotatePorts(mask: number, rot: number): number {
  const r = (((rot % 4) + 4) % 4) * 3;
  if (r === 0) return mask & 0xfff;
  return ((mask << r) | (mask >>> (12 - r))) & 0xfff;
}

/** Port on the neighbour that touches `port` across the shared edge. */
export function opposingPort(port: number): number {
  const side = Math.floor(port / 3);
  const k = port % 3;
  return ((side + 2) % 4) * 3 + (2 - k);
}

const SIDE_DELTA: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface ExtentTile {
  rot: number;
  /** Canonical port masks per feature (`FEAT` portMask). */
  ports: number[];
}

export interface ExtentCell {
  x: number;
  y: number;
  feature: number;
}

/**
 * Every (cell, feature) connected to `feature` on the tile at (x, y), following
 * ports across edges. `board` returns the tile at a cell (or undefined).
 */
export function featureExtent(board: (x: number, y: number) => ExtentTile | undefined, x: number, y: number, feature: number): ExtentCell[] {
  const out: ExtentCell[] = [];
  const seen = new Set<string>();
  const stack: ExtentCell[] = [{ x, y, feature }];
  while (stack.length > 0) {
    const c = stack.pop()!;
    const key = `${c.x},${c.y},${c.feature}`;
    if (seen.has(key)) continue;
    const t = board(c.x, c.y);
    if (!t) continue;
    seen.add(key);
    out.push(c);
    const mask = rotatePorts(t.ports[c.feature] ?? 0, t.rot);
    for (let p = 0; p < 12; p++) {
      if (!(mask & (1 << p))) continue;
      const side = Math.floor(p / 3);
      const [dx, dy] = SIDE_DELTA[side]!;
      const nx = c.x + dx;
      const ny = c.y + dy;
      const n = board(nx, ny);
      if (!n) continue;
      const q = opposingPort(p);
      n.ports.forEach((m, fi) => {
        if (rotatePorts(m, n.rot) & (1 << q)) stack.push({ x: nx, y: ny, feature: fi });
      });
    }
  }
  return out;
}
