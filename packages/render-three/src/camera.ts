// Camera modes (PRD §6.3): top-down orthographic, tabletop tilt (default),
// free orbit and cinematic (driven by the anim timeline's cameraFocus hints).
// One rig state (target, yaw, pitch, distance, fov) eases toward a goal every
// frame, so mode switches, board growth and focus moves are all smooth. The
// top-down mode approaches with a narrow-FOV perspective and swaps to a true
// orthographic camera once it settles (visually seamless).
import * as THREE from "three/webgpu";

export type CameraMode = "top" | "tabletop" | "orbit" | "cinematic";
export const CAMERA_MODES: CameraMode[] = ["top", "tabletop", "orbit", "cinematic"];

export interface RigState {
  tx: number;
  ty: number;
  tz: number;
  /** Radians about +y; 0 looks from +z (south) toward -z. */
  yaw: number;
  /** Elevation above the table plane, radians (PI/2 = straight down). */
  pitch: number;
  distance: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface BoardBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const DEG = Math.PI / 180;
const TOP_FOV = 8;

export function lerpState(a: RigState, b: RigState, k: number): RigState {
  let dy = b.yaw - a.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return {
    tx: a.tx + (b.tx - a.tx) * k,
    ty: a.ty + (b.ty - a.ty) * k,
    tz: a.tz + (b.tz - a.tz) * k,
    yaw: a.yaw + dy * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    distance: Math.exp(Math.log(a.distance) + (Math.log(b.distance) - Math.log(a.distance)) * k),
    fov: a.fov + (b.fov - a.fov) * k,
  };
}

/** Eye position for a rig state. */
export function eyeOf(s: RigState): [number, number, number] {
  const c = Math.cos(s.pitch);
  return [s.tx + Math.sin(s.yaw) * c * s.distance, s.ty + Math.sin(s.pitch) * s.distance, s.tz + Math.cos(s.yaw) * c * s.distance];
}

/** Distance at which a sphere of `radius` fills the view (fov in degrees, aspect w/h). */
export function fitDistance(radius: number, fov: number, aspect: number, margin = 1.08): number {
  const vf = (fov * DEG) / 2;
  const hf = Math.atan(Math.tan(vf) * aspect);
  return (radius * margin) / Math.sin(Math.min(vf, hf));
}

export class CameraRig {
  mode: CameraMode = "tabletop";
  readonly perspective: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  current: RigState;
  goal: RigState;
  /** Exponential approach rate (1/s). */
  rate = 4.5;
  reducedMotion = false;
  /** Extra yaw added to the cinematic drift (radians). */
  yawOffset = 0;
  private aspect = 1;
  private bounds: BoardBounds = { minX: -1, minZ: -1, maxX: 2, maxZ: 2 };
  private focus: { cx: number; cz: number; extent: number; priority: number; until: number } | null = null;
  private clock = 0;
  /** User orbit offsets (orbit mode). */
  private userZoom = 1;

  constructor() {
    this.perspective = new THREE.PerspectiveCamera(35, 1, 0.02, 200);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.02, 200);
    this.current = this.goalFor("tabletop");
    this.goal = { ...this.current };
  }

  /** The camera to render with this frame. */
  get active(): THREE.Camera {
    return this.useOrtho ? this.ortho : this.perspective;
  }

  get useOrtho(): boolean {
    return this.mode === "top" && Math.abs(this.current.pitch - Math.PI / 2) < 0.02 && Math.abs(this.current.fov - TOP_FOV) < 0.5;
  }

  setAspect(aspect: number): void {
    this.aspect = Math.max(0.1, aspect);
    this.goal = this.mode === "orbit" ? this.goal : this.goalFor(this.mode);
  }

  setBounds(b: BoardBounds): void {
    this.bounds = b;
    if (this.mode !== "orbit") this.goal = this.goalFor(this.mode);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.userZoom = 1;
    this.goal = mode === "orbit" ? { ...this.current, fov: 38, pitch: Math.min(this.current.pitch, 1.3) } : this.goalFor(mode);
    if (this.reducedMotion) this.current = { ...this.goal };
  }

  /** Cinematic hint from a `cameraFocus` clip (board-space centre + half extent). */
  hint(cx: number, cz: number, extent: number, priority: number, hold = 1.6): void {
    if (this.focus && this.focus.until > this.clock && this.focus.priority > priority) return;
    this.focus = { cx, cz, extent, priority, until: this.clock + hold };
    if (this.mode === "cinematic") this.goal = this.goalFor("cinematic");
  }

  private boardCenter(): { cx: number; cz: number; radius: number; w: number; d: number } {
    const b = this.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    return { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, radius: Math.max(1.2, Math.hypot(w, d) / 2), w, d };
  }

  goalFor(mode: CameraMode): RigState {
    const { cx, cz, radius, w, d } = this.boardCenter();
    switch (mode) {
      case "top": {
        // fit the board rectangle exactly (narrow fov ~ orthographic)
        const halfH = Math.max(d / 2, w / 2 / this.aspect) * 1.12 + 0.3;
        const dist = halfH / Math.tan((TOP_FOV * DEG) / 2);
        return { tx: cx, ty: 0, tz: cz, yaw: 0, pitch: Math.PI / 2, distance: dist, fov: TOP_FOV };
      }
      case "cinematic": {
        const f = this.focus && this.focus.until > this.clock ? this.focus : null;
        const fx = f ? f.cx : cx;
        const fz = f ? f.cz : cz;
        const ext = f ? Math.max(1.2, f.extent * 1.2) : radius;
        const yaw = -0.35 + this.yawOffset + Math.sin(this.clock * 0.07) * 0.5;
        return { tx: fx, ty: 0, tz: fz, yaw, pitch: 34 * DEG, distance: fitDistance(ext, 30, this.aspect, 1.1), fov: 30 };
      }
      case "orbit":
        return { ...this.goal };
      default: {
        // tabletop: tilted, slightly turned, framed on the board rectangle
        const s = this.fitRect({ tx: cx, ty: 0, tz: cz, yaw: -0.2, pitch: 44 * DEG, distance: radius * 3, fov: 34 }, 0.9);
        s.distance *= this.userZoom;
        return s;
      }
    }
  }

  /**
   * Adjust target and distance so the board rectangle (plus a little height
   * for props) fills `fill` of the viewport at the given yaw / pitch / fov.
   */
  fitRect(start: RigState, fill: number): RigState {
    const b = this.bounds;
    const s = { ...start };
    const cam = new THREE.PerspectiveCamera(s.fov, this.aspect, 0.01, 1000);
    const pts = [
      [b.minX, 0, b.minZ],
      [b.maxX, 0, b.minZ],
      [b.minX, 0, b.maxZ],
      [b.maxX, 0, b.maxZ],
      [b.minX, 0.25, b.minZ],
      [b.maxX, 0.25, b.minZ],
    ];
    const v = new THREE.Vector3();
    const halfV = Math.tan((s.fov * DEG) / 2);
    for (let it = 0; it < 8; it++) {
      const e = eyeOf(s);
      cam.position.set(e[0], e[1], e[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(s.tx, s.ty, s.tz);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        v.set(p[0]!, p[1]!, p[2]!).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      // recentre: screen right / up offsets back onto the ground plane
      const cxn = (x0 + x1) / 2;
      const cyn = (y0 + y1) / 2;
      const halfH = s.distance * halfV;
      const rx = Math.cos(s.yaw);
      const rz = -Math.sin(s.yaw);
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      s.tx += rx * cxn * halfH * this.aspect + (fx * cyn * halfH) / Math.sin(s.pitch);
      s.tz += rz * cxn * halfH * this.aspect + (fz * cyn * halfH) / Math.sin(s.pitch);
      const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2) / fill;
      s.distance = Math.max(1.2, s.distance * (0.35 + 0.65 * ext));
    }
    return s;
  }

  // --- orbit input -----------------------------------------------------------
  orbit(dx: number, dy: number): void {
    if (this.mode !== "orbit") this.setMode("orbit");
    this.goal.yaw -= dx * 0.008;
    this.goal.pitch = Math.max(12 * DEG, Math.min(89 * DEG, this.goal.pitch + dy * 0.006));
  }

  pan(dx: number, dy: number): void {
    if (this.mode !== "orbit") this.setMode("orbit");
    const s = this.goal.distance * 0.0016;
    const c = Math.cos(this.goal.yaw);
    const sn = Math.sin(this.goal.yaw);
    this.goal.tx -= (dx * c + dy * sn) * s;
    this.goal.tz -= (-dx * sn + dy * c) * s;
  }

  zoom(factor: number): void {
    if (this.mode === "orbit") this.goal.distance = Math.max(0.8, Math.min(80, this.goal.distance * factor));
    else {
      this.userZoom = Math.max(0.3, Math.min(3, this.userZoom * factor));
      this.goal = this.goalFor(this.mode);
      if (this.mode === "top" || this.mode === "cinematic") this.goal.distance *= this.userZoom;
    }
  }

  /** Advance the rig by dt seconds and update both cameras. */
  update(dt: number): void {
    this.clock += dt;
    if (this.mode === "cinematic") this.goal = this.goalFor("cinematic");
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-this.rate * dt);
    this.current = lerpState(this.current, this.goal, k);
    if (this.mode === "top" && Math.abs(this.current.pitch - this.goal.pitch) < 0.002 && Math.abs(this.current.fov - TOP_FOV) < 0.05) {
      this.current = { ...this.goal };
    }
    this.apply();
  }

  /** Snap to the goal (no transition). */
  snap(): void {
    this.current = { ...this.goal };
    this.apply();
  }

  private apply(): void {
    const s = this.current;
    const eye = eyeOf(s);
    const cam = this.perspective;
    cam.fov = s.fov;
    cam.aspect = this.aspect;
    cam.near = Math.max(0.02, s.distance * 0.02);
    cam.far = s.distance * 4 + 50;
    cam.position.set(eye[0], eye[1], eye[2]);
    // straight down needs an explicit up so yaw 0 keeps north at the top
    cam.up.set(0, 1, 0);
    if (s.pitch > 89.5 * DEG) cam.up.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    cam.lookAt(s.tx, s.ty, s.tz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const halfH = s.distance * Math.tan((s.fov * DEG) / 2);
    const o = this.ortho;
    o.left = -halfH * this.aspect;
    o.right = halfH * this.aspect;
    o.top = halfH;
    o.bottom = -halfH;
    o.near = cam.near;
    o.far = cam.far;
    o.position.copy(cam.position);
    o.up.copy(cam.up);
    o.lookAt(s.tx, s.ty, s.tz);
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
  }
}
