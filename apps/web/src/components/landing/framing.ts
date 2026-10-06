// Camera framing shared by the live hero board and the offline poster renders, so a
// poster is the live board's first frame. Pure math over the renderer's CameraRig
// state (no three.js import here): a pinhole projection of the occupied cells, fitted
// into the part of the viewport the page leaves free for the board.

export interface RigStateLike {
  tx: number;
  ty: number;
  tz: number;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

export interface RigLike {
  mode: string;
  goal: RigStateLike;
  current: RigStateLike;
  setMode(mode: "orbit"): void;
  snap(): void;
}

export interface ShotSpec {
  /** Radians about +y (0 looks from the south). */
  yaw: number;
  /** Elevation, degrees. */
  pitch: number;
  fov: number;
  /** Fraction of the free region the board fills (> 1 lets it run off the edges). */
  fill: number;
  /** Viewport fractions kept clear (text column), per side. */
  insets: { top: number; right: number; bottom: number; left: number };
}

const DEG = Math.PI / 180;

/** Desktop hero: board to the right of the headline, low three-quarter view. */
export const HERO_WIDE: ShotSpec = { yaw: -2.0, pitch: 36, fov: 26, fill: 1.5, insets: { top: 0, right: 0, bottom: 0, left: 0.5 } };
/** Phone poster: the board alone. */
export const HERO_NARROW: ShotSpec = { yaw: -2.0, pitch: 42, fov: 28, fill: 1.3, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
/** The styles showcase: the same board, centred and a little closer. */
export const SHOWCASE: ShotSpec = { yaw: -2.0, pitch: 38, fov: 26, fill: 1.7, insets: { top: 0, right: 0, bottom: 0, left: 0 } };

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function eyeOf(s: RigStateLike): V3 {
  const c = Math.cos(s.pitch);
  return [s.tx + Math.sin(s.yaw) * c * s.distance, s.ty + Math.sin(s.pitch) * s.distance, s.tz + Math.cos(s.yaw) * c * s.distance];
}

/** NDC bounding box of `pts` seen from `s`. */
function ndcBox(s: RigStateLike, aspect: number, pts: V3[]) {
  const eye = eyeOf(s);
  const f = norm(sub([s.tx, s.ty, s.tz], eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const ty = Math.tan((s.fov * DEG) / 2);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const d = sub(p, eye);
    const z = Math.max(1e-3, dot(d, f));
    const x = dot(d, r) / z / (ty * aspect);
    const y = dot(d, u) / z / ty;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

/** Camera state framing `cells` (board coordinates of placed tiles) per `spec`. */
export function shotState(cells: { x: number; y: number }[], aspect: number, spec: ShotSpec, drift = 0): RigStateLike {
  const list = cells.length ? cells : [{ x: 0, y: 0 }];
  const pts: V3[] = list.flatMap((c) => [
    [c.x, 0, c.y] as V3,
    [c.x + 1, 0, c.y] as V3,
    [c.x, 0, c.y + 1] as V3,
    [c.x + 1, 0, c.y + 1] as V3,
    [c.x + 0.5, 0.2, c.y + 0.5] as V3,
  ]);
  let cx = 0;
  let cz = 0;
  for (const c of list) {
    cx += c.x + 0.5;
    cz += c.y + 0.5;
  }
  cx /= list.length;
  cz /= list.length;
  let radius = 1;
  for (const c of list) radius = Math.max(radius, Math.hypot(c.x + 0.5 - cx, c.y + 0.5 - cz) + 0.8);
  const i = spec.insets;
  const free = { cx: i.left - i.right, cy: i.bottom - i.top, hw: Math.max(0.1, 1 - i.left - i.right), hh: Math.max(0.1, 1 - i.top - i.bottom) };
  const s: RigStateLike = { tx: cx, ty: 0, tz: cz, yaw: spec.yaw + drift, pitch: spec.pitch * DEG, fov: spec.fov, distance: radius * 3.2 };
  for (let it = 0; it < 24; it++) {
    const b = ndcBox(s, aspect, pts);
    const ext = Math.max((b.x1 - b.x0) / 2 / free.hw, (b.y1 - b.y0) / 2 / free.hh) / spec.fill;
    const ox = (b.x0 + b.x1) / 2 - free.cx;
    const oy = (b.y0 + b.y1) / 2 - free.cy;
    // screen offsets back onto the ground plane (right vector, and forward along the ground)
    const halfH = s.distance * Math.tan((s.fov * DEG) / 2);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const k = 0.8;
    s.tx += k * (rx * ox * halfH * aspect + (fx * oy * halfH) / Math.sin(s.pitch));
    s.tz += k * (rz * ox * halfH * aspect + (fz * oy * halfH) / Math.sin(s.pitch));
    s.distance = Math.max(1.5, s.distance * (0.4 + 0.6 * ext));
  }
  return s;
}

/** Put the rig in free orbit and jump straight to the shot (posters, first live frame). */
export function snapTo(rig: RigLike, cells: { x: number; y: number }[], aspect: number, spec: ShotSpec, drift = 0): void {
  if (rig.mode !== "orbit") rig.setMode("orbit");
  rig.goal = shotState(cells, aspect, spec, drift);
  rig.snap();
}

/** Ease toward the shot (live board: the board grows, the camera drifts). */
export function aimAt(rig: RigLike, cells: { x: number; y: number }[], aspect: number, spec: ShotSpec, drift = 0): void {
  if (rig.mode !== "orbit") rig.setMode("orbit");
  rig.goal = shotState(cells, aspect, spec, drift);
}
