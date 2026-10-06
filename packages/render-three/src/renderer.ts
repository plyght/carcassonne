// BoardRenderer: framework-agnostic Three.js board for the 3D styles.
//
//   const r = await BoardRenderer.create({ canvas, geo });
//   r.setView(view);                       // snap to a GameView
//   r.pushEvents(result.events, nextView); // animate engine events, then settle on nextView
//   r.setStyle("cartoon"); r.setCamera("top"); r.setTier("high");
//
// Inputs are protocol types only (GameView, EngineEvent); geometry comes from
// core-geo, motion from the core/anim timeline. Style/camera/tier switches
// never touch game state.
import * as THREE from "three/webgpu";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { AnimClip, AnimOptions, AnimTimeline, FigurePose, FigureShape, GeoFigure } from "@carcassonne/core-geo";
import type { BoardTile, EngineEvent, FigureOption, GameView, Placement, PlacedFigure, TileId } from "@carcassonne/protocol";
import { createRenderer, type BackendKind, type BackendPreference } from "./backend";
import { CameraRig, type CameraMode } from "./camera";
import { FigureLayer, PropLayer, type FigureInstance, type PropOwner } from "./layers";
import { createMaterials, type MaterialSet } from "./materials";
import { cellAt, featureAt, featureExtent, NO_FEATURE, rayPlaneY, type ExtentCell, type ExtentTile } from "./picking";
import { popupTexture } from "./popups";
import { buildPost, type PostChain } from "./post";
import { PropKit } from "./props";
import { DEFAULT_STYLE_ID, getStylePack, type StylePack, type Tier } from "./styles";
import { TileGeometryCache, type GeoSource, type TileGeometry } from "./tile-cache";
import { RealClock, TimelinePlayer, type Clock, type PlayingClip } from "./timeline";

/** What the renderer needs from @carcassonne/core-geo's `CoreGeo`. */
export interface GeoProvider extends GeoSource {
  figure(shape?: FigureShape, pose?: FigurePose): GeoFigure;
  animTimeline(events: EngineEvent[], options?: AnimOptions): AnimTimeline;
}

export interface BoardRendererOptions {
  canvas: HTMLCanvasElement;
  geo: GeoProvider;
  style?: StylePack | string;
  camera?: CameraMode;
  /** Performance tier; "auto" picks from the backend and device. */
  tier?: Tier | "auto";
  /** Defaults to the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
  backend?: BackendPreference;
  /** Frame clock (inject a ManualClock for deterministic tests / captures). */
  clock?: Clock;
  /** Run an internal animation loop (default true). Otherwise call `frame()`. */
  autoRender?: boolean;
  /** Handle pointer input on the canvas (default true). */
  interactive?: boolean;
  pixelRatio?: number;
  antialias?: boolean;
}

export interface PickResult {
  cell: { x: number; y: number };
  /** World point on the table plane (x, z = board space). */
  point: [number, number];
  tile: { tile: TileId; rot: number } | null;
  /** Feature index under the pointer on that tile (or on the pending ghost), or null. */
  feature: number | null;
}

export interface RendererStats {
  backend: BackendKind;
  tier: Tier;
  style: string;
  camera: CameraMode;
  tiles: number;
  figures: number;
  drawCalls: number;
  triangles: number;
  /** CPU time of the last frame's render submission (ms). */
  frameMs: number;
  /** Smoothed wall-clock interval between frames (ms). */
  intervalMs: number;
  meshCache: { size: number; hits: number; misses: number };
}

export type RendererEvent =
  | { type: "hover"; pick: PickResult | null; placement: Placement | null }
  | { type: "click"; pick: PickResult; placement: Placement | null }
  | { type: "animationEnd" };

interface TileEntry extends PropOwner {
  key: string;
  x: number;
  y: number;
  rot: number;
  tile: TileId;
  geom: TileGeometry;
  group: THREE.Group;
  ground: THREE.Mesh;
  wall: THREE.Mesh | null;
  water: THREE.Mesh | null;
  drop: number;
  squash: number;
  jitter: number;
  dirty: boolean;
}

interface FigureEntry {
  key: string;
  x: number;
  y: number;
  feature: number;
  player: number;
  figure: "meeple" | "abbot";
  /** Hop animation offsets. */
  lift: number;
  scale: number;
  squash: number;
  visible: boolean;
  removing: boolean;
}

interface Popup {
  key: string;
  sprite: THREE.Sprite;
  x: number;
  z: number;
}

interface Highlight {
  key: string;
  meshes: THREE.Mesh[];
  material: THREE.MeshBasicNodeMaterial;
}

const tkey = (x: number, y: number) => `${x},${y}`;
const fkey = (x: number, y: number, f: number) => `${x},${y},${f}`;

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function autoTier(backend: BackendKind): Tier {
  if (typeof navigator === "undefined") return "medium";
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return "low";
  return backend === "webgpu" ? "high" : "medium";
}

export class BoardRenderer {
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: BackendKind;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  canvas: HTMLCanvasElement;

  private geo: GeoProvider;
  private style: StylePack;
  private tier: Tier;
  private reducedMotion: boolean;
  private clock: Clock;
  private cache: TileGeometryCache;
  private kit: PropKit;
  private mats: MaterialSet;
  private props: PropLayer;
  private figuresLayer: FigureLayer;
  private post: PostChain | null = null;
  private postCamera: THREE.Camera | null = null;
  private timeline: TimelinePlayer;

  private tiles = new Map<string, TileEntry>();
  private figures = new Map<string, FigureEntry>();
  private popups = new Map<string, Popup>();
  private highlights = new Map<string, Highlight>();
  private hover: Highlight | null = null;
  private hoverKey = "";

  private tilesRoot = new THREE.Group();
  private overlayRoot = new THREE.Group();
  private table: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private envTexture: THREE.Texture | null = null;

  private hints: { tile: TileId; placements: Placement[] } | null = null;
  private legalMesh: THREE.InstancedMesh | null = null;
  private ghost: { placement: Placement; tile: TileId; group: THREE.Group; key: string } | null = null;
  private pending: { placement: Placement; tile: TileId; options: FigureOption[] } | null = null;
  private listeners = new Set<(e: RendererEvent) => void>();
  private propsDirty = true;
  private boundsDirty = true;
  private lastFrameMs = 0;
  private lastDraws = 0;
  private counter = { draws: 0, tris: 0 };
  private lastTris = 0;
  private intervalMs = 16;
  private lastStamp = 0;
  private disposed = false;
  private autoRender = true;
  private resizeObs: ResizeObserver | null = null;
  private detachInput: (() => void) | null = null;

  private constructor(opts: BoardRendererOptions, created: { renderer: THREE.WebGPURenderer; backend: BackendKind; canvas: HTMLCanvasElement }) {
    this.renderer = created.renderer;
    this.backend = created.backend;
    this.canvas = created.canvas;
    this.geo = opts.geo;
    this.style = typeof opts.style === "object" ? opts.style : getStylePack(opts.style ?? DEFAULT_STYLE_ID);
    this.tier = !opts.tier || opts.tier === "auto" ? autoTier(this.backend) : opts.tier;
    this.reducedMotion = opts.reducedMotion ?? prefersReducedMotion();
    this.clock = opts.clock ?? new RealClock();
    this.cache = new TileGeometryCache(this.geo);
    this.kit = new PropKit({ rounded: this.style.props.rounded });
    this.mats = createMaterials(this.style);
    this.props = new PropLayer(this.kit, this.mats.props);
    this.figuresLayer = new FigureLayer((s, p) => this.geo.figure(s, p), this.mats.figure);
    this.timeline = new TimelinePlayer({ onStart: (c) => this.clipStart(c), onEnd: (c) => this.clipEnd(c) });

    this.renderer.setPixelRatio(opts.pixelRatio ?? Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // count draws ourselves (nested pipeline passes, shadow maps included)
    const info = this.renderer.info as unknown as { update(o: THREE.Object3D, count: number, inst: number): void };
    const orig = info.update.bind(info);
    info.update = (o, count, inst) => {
      this.counter.draws++;
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) this.counter.tris += inst * (count / 3);
      orig(o, count, inst);
    };

    this.tilesRoot.name = "tiles";
    this.overlayRoot.name = "overlays";
    this.scene.add(this.tilesRoot, this.props.root, this.figuresLayer.root, this.overlayRoot);

    this.table = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.mats.table);
    this.table.receiveShadow = true;
    this.table.name = "table";
    this.scene.add(this.table);

    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.rig.reducedMotion = this.reducedMotion;
    this.rig.setMode(opts.camera ?? "tabletop");
    this.applyStyleScene();
    this.applyTier();

    const w = this.canvas.clientWidth || this.canvas.width || 800;
    const h = this.canvas.clientHeight || this.canvas.height || 600;
    this.resize(w, h);
    this.rig.snap();

    if (opts.interactive !== false) this.detachInput = this.attachInput();
    if (typeof ResizeObserver !== "undefined" && this.canvas.parentElement) {
      this.resizeObs = new ResizeObserver(() => {
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (cw > 0 && ch > 0) this.resize(cw, ch);
      });
      this.resizeObs.observe(this.canvas);
    }
    this.autoRender = opts.autoRender !== false;
    if (this.autoRender) this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Creates the renderer (WebGPU, falling back to WebGL2). */
  static async create(opts: BoardRendererOptions): Promise<BoardRenderer> {
    const created = await createRenderer(opts.canvas, opts.backend ?? "auto", opts.antialias ?? true);
    return new BoardRenderer(opts, created);
  }

  // ---------------------------------------------------------------------------
  // Public API

  on(fn: (e: RendererEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Snap the board to a GameView (no animation). Pending animations finish first. */
  setView(view: GameView): void {
    this.timeline.finish();
    this.syncView(view);
  }

  /**
   * Animate engine events (one `apply` result) using the core/anim timeline,
   * then settle on `view` when the animation ends. Batches queue in order.
   */
  pushEvents(events: EngineEvent[], view?: GameView): void {
    const tl = this.geo.animTimeline(events, {
      style: this.reducedMotion ? "reduced" : this.style.anim.preset,
      speed: this.style.anim.speed,
    });
    // stage new tiles hidden; their clips reveal them
    const rises = new Set<string>();
    const walls = new Set<string>();
    for (const c of tl.clips) {
      if (c.target.type !== "tile") continue;
      if (c.kind === "lifeRise") rises.add(tkey(c.target.x, c.target.y));
      if (c.kind === "wallExtrude") walls.add(tkey(c.target.x, c.target.y));
    }
    for (const e of events) {
      if (e.type !== "tilePlaced" || this.tiles.has(tkey(e.x, e.y))) continue;
      const t = this.addTile({ x: e.x, y: e.y, rot: e.rot, tile: e.tile, figures: [] });
      t.visible = false;
      t.rise = rises.has(t.key) ? 0 : 1;
      t.wallRise = walls.has(t.key) ? 0 : 1;
      t.dirty = true;
    }
    this.timeline.enqueue(tl, () => {
      if (view) this.syncView(view);
      this.emit({ type: "animationEnd" });
    });
    if (this.reducedMotion) this.timeline.advance(0);
  }

  /** True while event animations are playing. */
  get animating(): boolean {
    return this.timeline.busy;
  }

  /** Skip running animations to their end state. */
  finishAnimations(): void {
    this.timeline.finish();
  }

  setStyle(style: StylePack | string): void {
    const next = typeof style === "object" ? style : getStylePack(style);
    if (next === this.style) return;
    const prev = this.style;
    this.style = next;
    const old = this.mats;
    this.mats = createMaterials(next);
    if (prev.props.rounded !== next.props.rounded) {
      this.kit.dispose();
      this.kit = new PropKit({ rounded: next.props.rounded });
      this.props.setKit(this.kit);
    }
    this.props.setMaterial(this.mats.props);
    this.figuresLayer.setMaterial(this.mats.figure);
    this.table.material = this.mats.table;
    const resChanged = prev.terrain.resolution[this.tier] !== next.terrain.resolution[this.tier];
    for (const t of this.tiles.values()) {
      if (resChanged) this.rebuildTileMeshes(t);
      else this.assignTileMaterials(t);
      t.dirty = true;
    }
    this.clearHighlights();
    this.rebuildGhost();
    this.rebuildLegal();
    this.propsDirty = true;
    this.applyStyleScene();
    this.applyTier();
    old.dispose();
  }

  get styleId(): string {
    return this.style.id;
  }

  setCamera(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  get cameraMode(): CameraMode {
    return this.rig.mode;
  }

  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    const resChanged = this.style.terrain.resolution[tier] !== this.style.terrain.resolution[this.tier];
    this.tier = tier;
    if (resChanged) {
      for (const t of this.tiles.values()) this.rebuildTileMeshes(t);
      this.propsDirty = true;
      this.rebuildGhost();
    }
    this.applyTier();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.rig.reducedMotion = on;
    if (on) this.timeline.finish();
  }

  /** Legal placements for the current tile: shows cell markers and a ghost on hover. */
  setPlacementHints(hints: { tile: TileId; placements: Placement[] } | null): void {
    this.hints = hints && hints.placements.length > 0 ? hints : null;
    this.rebuildLegal();
    if (!this.hints) this.setGhost(null);
  }

  /** Show (or clear) the translucent ghost of a tile at a placement. */
  setGhost(p: Placement | null, tile?: TileId): void {
    const id = tile ?? this.pending?.tile ?? this.hints?.tile;
    if (!p || !id) {
      if (this.ghost) {
        this.overlayRoot.remove(this.ghost.group);
        this.ghost = null;
      }
      return;
    }
    const key = `${id}|${p.x},${p.y},${p.rot}`;
    if (this.ghost?.key === key) return;
    if (this.ghost) this.overlayRoot.remove(this.ghost.group);
    this.ghost = { placement: p, tile: id, group: this.buildGhost(id, p), key };
    this.overlayRoot.add(this.ghost.group);
  }

  get ghostPlacement(): Placement | null {
    return this.ghost?.placement ?? null;
  }

  /** Rotate the ghost to the next legal rotation at its cell (dir = +1 clockwise). */
  rotateGhost(dir: 1 | -1 = 1): Placement | null {
    const g = this.ghost?.placement;
    if (!g || !this.hints) return null;
    const rots = this.hints.placements.filter((p) => p.x === g.x && p.y === g.y).map((p) => p.rot);
    if (rots.length === 0) return null;
    let r = g.rot;
    for (let i = 0; i < 4; i++) {
      r = (((r + dir) % 4) + 4) % 4;
      if (rots.includes(r as Placement["rot"])) break;
    }
    const p = { x: g.x, y: g.y, rot: r as Placement["rot"] };
    this.setGhost(p);
    return p;
  }

  /**
   * After a tile is chosen (before the figure action): keep its ghost at
   * `placement` and offer `options` as hover/click hotspots. Pass null to clear.
   */
  setPendingPlacement(placement: Placement | null, options: FigureOption[] = [], tile?: TileId): void {
    const id = tile ?? this.hints?.tile ?? this.pending?.tile;
    this.pending = placement && id ? { placement, tile: id, options } : null;
    if (this.pending) this.setGhost(placement, id);
    this.setHover(null);
  }

  /** Highlight the full extent of a feature (cell + feature index), or clear. */
  highlightFeature(x: number, y: number, feature: number | null): void {
    if (feature === null) return this.setHover(null);
    this.setHover({ x, y, feature });
  }

  /** Feature extent across the board (pure lookup over placed tiles + pending ghost). */
  extentOf(x: number, y: number, feature: number): ExtentCell[] {
    return featureExtent((cx, cy) => this.extentTile(cx, cy), x, y, feature);
  }

  /** Ray-pick the board at client coordinates. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.pickNdc(nx, ny);
  }

  pickNdc(nx: number, ny: number): PickResult | null {
    const cam = this.rig.active;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const hit = rayPlaneY([o.x, o.y, o.z], [d.x, d.y, d.z], 0);
    if (!hit) return null;
    const cell = cellAt(hit[0], hit[2]);
    const t = this.tiles.get(tkey(cell.x, cell.y));
    const lx = hit[0] - cell.x;
    const lz = hit[2] - cell.y;
    let tile: PickResult["tile"] = null;
    let feature: number | null = null;
    const geomAt = t ? t.geom : this.pending && this.pending.placement.x === cell.x && this.pending.placement.y === cell.y ? this.tileGeom(this.pending.tile, this.pending.placement.rot) : null;
    if (geomAt) {
      tile = { tile: geomAt.tile, rot: geomAt.rot };
      const f = featureAt({ featureIds: geomAt.featureGrid, resolution: geomAt.resolution, anchors: geomAt.canonicalAnchors }, geomAt.rot, lx, lz);
      feature = f === NO_FEATURE ? null : f;
    }
    return { cell, point: [hit[0], hit[2]], tile, feature };
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / Math.max(1, height));
  }

  stats(): RendererStats {
    return {
      backend: this.backend,
      tier: this.tier,
      style: this.style.id,
      camera: this.rig.mode,
      tiles: this.tiles.size,
      figures: this.figures.size,
      drawCalls: this.lastDraws,
      triangles: this.lastTris,
      frameMs: this.lastFrameMs,
      intervalMs: this.intervalMs,
      meshCache: { size: this.cache.size, hits: this.cache.hits, misses: this.cache.misses },
    };
  }

  /** Advance animations by the clock and render one frame. */
  frame(): void {
    if (this.disposed) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.lastStamp > 0) this.intervalMs = this.intervalMs * 0.9 + (now - this.lastStamp) * 0.1;
    this.lastStamp = now;
    const dt = this.clock.delta();
    this.update(dt);
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.counter.draws = 0;
    this.counter.tris = 0;
    // Outside setAnimationLoop the node frame (per-frame passes, `time`) must be advanced by hand.
    if (!this.autoRender) (this.renderer as unknown as { _nodes?: { nodeFrame: { update(): void } } })._nodes?.nodeFrame.update();
    this.draw();
    this.lastFrameMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    this.lastDraws = this.counter.draws;
    this.lastTris = this.counter.tris;
  }

  /** Waits until GPU work for the last frame is done (captures / benchmarks). */
  async settle(): Promise<void> {
    const be = this.renderer.backend as unknown as { gl?: WebGL2RenderingContext; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } };
    if (be.device) await be.device.queue.onSubmittedWorkDone();
    else if (be.gl) be.gl.readPixels(0, 0, 1, 1, be.gl.RGBA, be.gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.detachInput?.();
    this.resizeObs?.disconnect();
    this.post?.dispose();
    this.props.dispose();
    this.figuresLayer.dispose();
    this.cache.clear();
    this.kit.dispose();
    this.mats.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------------------
  // Board state

  private syncView(view: GameView): void {
    const want = new Map<string, BoardTile>();
    for (const b of view.board) want.set(tkey(b.x, b.y), b);
    for (const [k, t] of this.tiles) {
      const b = want.get(k);
      if (!b || b.tile !== t.tile || b.rot !== t.rot) this.removeTile(k);
    }
    for (const [k, b] of want) {
      let t = this.tiles.get(k);
      if (!t) t = this.addTile(b);
      t.visible = true;
      t.drop = 0;
      t.squash = 0;
      t.rise = 1;
      t.wallRise = 1;
      t.dirty = true;
    }
    const figs = new Map<string, PlacedFigure & { x: number; y: number }>();
    for (const b of view.board) for (const f of b.figures) figs.set(fkey(b.x, b.y, f.feature), { ...f, x: b.x, y: b.y });
    for (const k of [...this.figures.keys()]) if (!figs.has(k)) this.figures.delete(k);
    for (const [k, f] of figs) {
      const cur = this.figures.get(k);
      if (cur && cur.player === f.player && cur.figure === f.figure) {
        Object.assign(cur, { lift: 0, scale: 1, squash: 0, visible: true, removing: false });
        continue;
      }
      this.figures.set(k, { key: k, x: f.x, y: f.y, feature: f.feature, player: f.player, figure: f.figure, lift: 0, scale: 1, squash: 0, visible: true, removing: false });
    }
    if (this.pending && want.has(tkey(this.pending.placement.x, this.pending.placement.y))) this.setPendingPlacement(null);
    if (this.ghost && want.has(tkey(this.ghost.placement.x, this.ghost.placement.y))) this.setGhost(null);
  }

  private tileGeom(tile: TileId, rot: number): TileGeometry {
    return this.cache.get(tile, rot, this.style.terrain.resolution[this.tier]);
  }

  private addTile(b: BoardTile): TileEntry {
    const key = tkey(b.x, b.y);
    const geom = this.tileGeom(b.tile, b.rot);
    const group = new THREE.Group();
    group.name = `tile ${b.tile}@${key}`;
    const entry: TileEntry = {
      key,
      x: b.x,
      y: b.y,
      rot: b.rot,
      tile: b.tile,
      geom,
      group,
      ground: null as unknown as THREE.Mesh,
      wall: null,
      water: null,
      drop: 0,
      squash: 0,
      jitter: (hash2(b.x, b.y) * 2 - 1) * this.style.terrain.heightJitter,
      matrix: new THREE.Matrix4(),
      props: geom.props,
      rise: 1,
      wallRise: 1,
      visible: true,
      slots: [],
      dirty: true,
    };
    this.buildTileMeshes(entry);
    this.tiles.set(key, entry);
    this.tilesRoot.add(group);
    this.propsDirty = true;
    this.boundsDirty = true;
    return entry;
  }

  private buildTileMeshes(t: TileEntry): void {
    const g = t.geom;
    t.group.clear();
    t.ground = new THREE.Mesh(g.ground, this.mats.ground);
    t.ground.castShadow = true;
    t.ground.receiveShadow = true;
    t.group.add(t.ground);
    t.wall = g.wall ? new THREE.Mesh(g.wall, this.mats.wall) : null;
    if (t.wall) {
      t.wall.castShadow = true;
      t.wall.receiveShadow = true;
      t.group.add(t.wall);
    }
    t.water = g.water ? new THREE.Mesh(g.water, this.mats.water) : null;
    if (t.water) {
      t.water.receiveShadow = true;
      t.group.add(t.water);
    }
    for (const m of t.group.children) m.matrixAutoUpdate = false;
    t.group.matrixAutoUpdate = false;
  }

  private assignTileMaterials(t: TileEntry): void {
    t.ground.material = this.mats.ground;
    if (t.wall) t.wall.material = this.mats.wall;
    if (t.water) t.water.material = this.mats.water;
  }

  private rebuildTileMeshes(t: TileEntry): void {
    t.geom = this.tileGeom(t.tile, t.rot);
    t.props = t.geom.props;
    this.buildTileMeshes(t);
    t.dirty = true;
  }

  private removeTile(k: string): void {
    const t = this.tiles.get(k);
    if (!t) return;
    this.tilesRoot.remove(t.group);
    this.tiles.delete(k);
    this.propsDirty = true;
    this.boundsDirty = true;
  }

  private extentTile(x: number, y: number): ExtentTile | undefined {
    const t = this.tiles.get(tkey(x, y));
    if (t) return { rot: t.rot, ports: t.geom.features.map((f) => f.ports) };
    const p = this.pending;
    if (p && p.placement.x === x && p.placement.y === y) {
      const g = this.tileGeom(p.tile, p.placement.rot);
      return { rot: p.placement.rot, ports: g.features.map((f) => f.ports) };
    }
    return undefined;
  }

  /** Recompute a tile's world matrix (gap scale, jitter, drop, squash). */
  private tileMatrix(t: TileEntry): void {
    const gap = 1 - this.style.terrain.tileGap;
    const sy = 1 - t.squash;
    const sxz = gap * (1 + t.squash * 0.5);
    const m = t.matrix;
    m.makeTranslation(-0.5, 0, -0.5);
    m.premultiply(new THREE.Matrix4().makeScale(sxz, sy, sxz));
    m.premultiply(new THREE.Matrix4().makeTranslation(t.x + 0.5, t.jitter + t.drop, t.y + 0.5));
    t.group.matrix.copy(m);
    t.group.matrixWorldNeedsUpdate = true;
    t.group.visible = t.visible;
    if (t.wall) {
      t.wall.matrix.makeScale(1, Math.max(0.001, t.wallRise), 1);
      t.wall.matrixWorldNeedsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Timeline

  private clipStart(c: PlayingClip): void {
    const clip = c.clip;
    const tg = clip.target;
    switch (clip.kind) {
      case "tileDrop": {
        if (tg.type !== "tile") break;
        const t = this.tiles.get(tkey(tg.x, tg.y));
        if (t) {
          t.visible = true;
          t.drop = clip.params?.fromHeight ?? 0.6;
          t.dirty = true;
        }
        break;
      }
      case "meepleHopIn": {
        if (tg.type !== "figure") break;
        const k = fkey(tg.x, tg.y, tg.feature);
        this.figures.set(k, { key: k, x: tg.x, y: tg.y, feature: tg.feature, player: tg.player, figure: tg.figure, lift: 1, scale: 1, squash: 0, visible: true, removing: false });
        break;
      }
      case "meepleHopOut": {
        if (tg.type !== "figure") break;
        const f = tg.feature >= 0 ? this.figures.get(fkey(tg.x, tg.y, tg.feature)) : [...this.figures.values()].find((x) => x.x === tg.x && x.y === tg.y && x.figure === "abbot");
        if (f) f.removing = true;
        break;
      }
      case "featurePulse": {
        if (tg.type !== "feature") break;
        const cells = this.resolveFeatureCells(tg.kind, tg.cells);
        if (cells.length > 0) this.highlights.set(c.key, this.buildHighlight(c.key, cells, "#fff2a8"));
        break;
      }
      case "scorePopup": {
        if (tg.type !== "point") break;
        const pts = clip.params?.points ?? 0;
        const w = clip.params?.winners?.[0];
        const tex = popupTexture(this.style.popups, pts, w === undefined ? null : this.playerColor(w).getStyle());
        if (!tex) break;
        const mat = new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
        const s = new THREE.Sprite(mat);
        s.renderOrder = 10;
        s.position.set(tg.x, 0.3, tg.y);
        s.scale.setScalar(0.0001);
        s.center.set(0.5, 0);
        this.overlayRoot.add(s);
        this.popups.set(c.key, { key: c.key, sprite: s, x: tg.x, z: tg.y });
        break;
      }
      case "cameraFocus": {
        const p = clip.params ?? {};
        if (p.cx !== undefined && p.cy !== undefined) this.rig.hint(p.cx, p.cy, p.extent ?? 1.5, p.priority ?? 0.3, Math.max(1.2, clip.duration * 3));
        else if (tg.type === "board") {
          const b = this.bounds();
          const [cx, cz] = this.boardCentre();
          this.rig.hint(cx, cz, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2, p.priority ?? 1, 3);
        }
        break;
      }
      default:
        break;
    }
  }

  private clipEnd(c: PlayingClip): void {
    const clip = c.clip;
    const tg = clip.target;
    switch (clip.kind) {
      case "tileDrop":
      case "lifeRise":
      case "wallExtrude": {
        if (tg.type !== "tile") break;
        const t = this.tiles.get(tkey(tg.x, tg.y));
        if (!t) break;
        t.visible = true;
        if (clip.kind === "tileDrop") {
          t.drop = 0;
          t.squash = 0;
        }
        if (clip.kind === "lifeRise") t.rise = 1;
        if (clip.kind === "wallExtrude") t.wallRise = 1;
        t.dirty = true;
        break;
      }
      case "meepleHopIn": {
        if (tg.type !== "figure") break;
        const f = this.figures.get(fkey(tg.x, tg.y, tg.feature));
        if (f) Object.assign(f, { lift: 0, scale: 1, squash: 0 });
        break;
      }
      case "meepleHopOut": {
        if (tg.type !== "figure") break;
        for (const [k, f] of this.figures) if (f.removing && f.x === tg.x && f.y === tg.y && (tg.feature < 0 || f.feature === tg.feature)) this.figures.delete(k);
        break;
      }
      case "featurePulse": {
        const h = this.highlights.get(c.key);
        if (h) {
          for (const m of h.meshes) this.overlayRoot.remove(m);
          h.material.dispose();
          this.highlights.delete(c.key);
        }
        break;
      }
      case "scorePopup": {
        const p = this.popups.get(c.key);
        if (p) {
          this.overlayRoot.remove(p.sprite);
          (p.sprite.material as THREE.SpriteNodeMaterial).map?.dispose();
          p.sprite.material.dispose();
          this.popups.delete(c.key);
        }
        break;
      }
      default:
        break;
    }
  }

  private applyClip(clip: AnimClip, key: string, t: number, p: number): void {
    const tg = clip.target;
    const cartoon = this.style.anim;
    switch (clip.kind) {
      case "tileDrop": {
        if (tg.type !== "tile") break;
        const e = this.tiles.get(tkey(tg.x, tg.y));
        if (!e) break;
        const h = clip.params?.fromHeight ?? 0.6;
        e.drop = h * (1 - p);
        // squash on landing (cartoon): peaks just after contact
        const sq = (clip.params?.squash ?? 0) + cartoon.squash;
        e.squash = sq > 0 && t > 0.55 ? sq * 0.35 * Math.sin(((t - 0.55) / 0.45) * Math.PI) : 0;
        e.dirty = true;
        break;
      }
      case "lifeRise":
      case "wallExtrude": {
        if (tg.type !== "tile") break;
        const e = this.tiles.get(tkey(tg.x, tg.y));
        if (!e) break;
        const over = 1 + (p - 1) * (1 + cartoon.overshoot);
        if (clip.kind === "lifeRise") e.rise = Math.max(0, over);
        else e.wallRise = Math.max(0, over);
        e.dirty = true;
        break;
      }
      case "meepleHopIn": {
        if (tg.type !== "figure") break;
        const f = this.figures.get(fkey(tg.x, tg.y, tg.feature));
        if (!f) break;
        const hop = clip.params?.hopHeight ?? 0.25;
        f.lift = (1 - Math.min(1, p)) * 0.5 + Math.sin(Math.PI * t) * hop * 0.4;
        const sq = (clip.params?.squash ?? 0) + cartoon.squash;
        f.squash = sq > 0 ? Math.sin(Math.PI * Math.min(1, t * 1.4)) * -sq * 0.4 + (t > 0.7 ? Math.sin(((t - 0.7) / 0.3) * Math.PI) * sq * 0.5 : 0) : 0;
        f.scale = 1;
        break;
      }
      case "meepleHopOut": {
        if (tg.type !== "figure") break;
        for (const f of this.figures.values()) {
          if (!f.removing || f.x !== tg.x || f.y !== tg.y || (tg.feature >= 0 && f.feature !== tg.feature)) continue;
          const hop = clip.params?.hopHeight ?? 0.3;
          f.lift = Math.sin(Math.PI * Math.min(1, t)) * hop + t * 0.25;
          f.scale = Math.max(0, 1 - Math.max(0, t - 0.5) * 2);
        }
        break;
      }
      case "featurePulse": {
        const h = this.highlights.get(key);
        if (h) h.material.opacity = 0.85 * Math.sin(Math.PI * Math.min(1, t)) * (0.75 + 0.25 * Math.sin(t * Math.PI * 6));
        break;
      }
      case "scorePopup": {
        const pop = this.popups.get(key);
        if (!pop) break;
        const s = clip.easing === "step" ? 0.7 : 0.7 * Math.max(0, Math.min(1.3, p));
        pop.sprite.scale.setScalar(s);
        pop.sprite.position.y = 0.32 + (clip.easing === "step" ? 0 : t * 0.35);
        (pop.sprite.material as THREE.SpriteNodeMaterial).opacity = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        break;
      }
      default:
        break;
    }
  }

  /** Which (cell, feature) set a scored `kind` + `cells` refers to. */
  private resolveFeatureCells(kind: string, cells: [number, number][]): ExtentCell[] {
    if (cells.length === 0) return [];
    const want = new Set(cells.map(([x, y]) => tkey(x, y)));
    const [x0, y0] = cells[0]!;
    const t = this.tiles.get(tkey(x0, y0));
    if (!t) return [];
    let best: ExtentCell[] = [];
    let bestScore = -1;
    t.geom.features.forEach((f, i) => {
      if (f.kind !== kind) return;
      const ext = kind === "cloister" || kind === "garden" ? [{ x: x0, y: y0, feature: i }] : this.extentOf(x0, y0, i);
      const covered = ext.filter((c) => want.has(tkey(c.x, c.y))).length;
      const score = covered - (ext.length - covered) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = ext;
      }
    });
    if (kind === "cloister" || kind === "garden") {
      // highlight the 3x3 neighbourhood that scored
      return cells.flatMap(([x, y]) => {
        const e = this.tiles.get(tkey(x, y));
        if (!e) return [];
        return [...e.geom.featureTriangles.keys()].map((feature) => ({ x, y, feature }));
      });
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Overlays

  private buildHighlight(key: string, cells: ExtentCell[], color: string): Highlight {
    const mat = this.mats.highlight.clone() as THREE.MeshBasicNodeMaterial;
    mat.color = new THREE.Color(color);
    const meshes: THREE.Mesh[] = [];
    for (const c of cells) {
      const t = this.tiles.get(tkey(c.x, c.y));
      const g = t ? t.geom : this.pending && this.pending.placement.x === c.x && this.pending.placement.y === c.y ? this.tileGeom(this.pending.tile, this.pending.placement.rot) : null;
      if (!g) continue;
      const tris = g.featureTriangles.get(c.feature);
      if (!tris) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", g.ground.getAttribute("position"));
      geom.setIndex(new THREE.BufferAttribute(tris, 1));
      geom.boundingSphere = g.ground.boundingSphere;
      const m = new THREE.Mesh(geom, mat);
      if (t) {
        this.tileMatrix(t);
        m.matrix.copy(t.matrix);
      } else {
        m.matrix.makeTranslation(c.x, 0, c.y);
      }
      m.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, 0.003, 0));
      m.matrixAutoUpdate = false;
      m.renderOrder = 5;
      this.overlayRoot.add(m);
      meshes.push(m);
    }
    return { key, meshes, material: mat };
  }

  private clearHighlights(): void {
    for (const h of this.highlights.values()) {
      for (const m of h.meshes) this.overlayRoot.remove(m);
      h.material.dispose();
    }
    this.highlights.clear();
    this.setHover(null);
  }

  private setHover(target: { x: number; y: number; feature: number } | null): void {
    const k = target ? fkey(target.x, target.y, target.feature) : "";
    if (k === this.hoverKey) return;
    this.hoverKey = k;
    if (this.hover) {
      for (const m of this.hover.meshes) this.overlayRoot.remove(m);
      this.hover.material.dispose();
      this.hover = null;
    }
    if (!target) return;
    const cells = this.extentOf(target.x, target.y, target.feature);
    this.hover = this.buildHighlight("hover", cells, "#fff7d1");
    this.hover.material.opacity = 0.4;
  }

  private rebuildLegal(): void {
    if (this.legalMesh) {
      this.overlayRoot.remove(this.legalMesh);
      this.legalMesh.dispose();
      this.legalMesh = null;
    }
    if (!this.hints) return;
    const cells = new Map<string, Placement>();
    for (const p of this.hints.placements) cells.set(tkey(p.x, p.y), p);
    const geom = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geom, this.mats.legal, Math.max(1, cells.size));
    let i = 0;
    const m = new THREE.Matrix4();
    for (const p of cells.values()) mesh.setMatrixAt(i++, m.makeTranslation(p.x + 0.5, 0.004, p.y + 0.5));
    mesh.count = cells.size;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.legalMesh = mesh;
    this.overlayRoot.add(mesh);
  }

  private buildGhost(tile: TileId, p: Placement): THREE.Group {
    const g = this.tileGeom(tile, p.rot);
    const group = new THREE.Group();
    group.name = "ghost";
    const ground = new THREE.Mesh(g.ground, this.mats.ghost.ground);
    group.add(ground);
    if (g.wall) group.add(new THREE.Mesh(g.wall, this.mats.ghost.wall));
    if (g.water) group.add(new THREE.Mesh(g.water, this.mats.ghost.water));
    // props for the ghost: one small instanced mesh per (prop, variant)
    const byKind = new Map<string, typeof g.props>();
    for (const pr of g.props) {
      const k = `${pr.prop}:${this.kit.variantOf(pr.prop, pr.variant)}`;
      let l = byKind.get(k);
      if (!l) byKind.set(k, (l = []));
      l.push(pr);
    }
    const mm = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const list of byKind.values()) {
      const base = this.kit.geometry(list[0]!.prop, list[0]!.variant);
      const geom = new THREE.BufferGeometry();
      for (const name of Object.keys(base.attributes)) geom.setAttribute(name, base.getAttribute(name));
      geom.setAttribute("aTint", new THREE.InstancedBufferAttribute(Float32Array.from(list.map((x) => x.tint % 4)), 1));
      const im = new THREE.InstancedMesh(geom, this.mats.ghost.props, list.length);
      list.forEach((pr, i) => {
        const sc = pr.scale * this.style.props.scale;
        s.set(sc, sc * pr.height * (pr.prop === "house" ? this.style.props.houseHeight : 1), sc);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pr.yaw);
        mm.compose(v.set(pr.x, pr.y, pr.z), q, s);
        im.setMatrixAt(i, mm);
      });
      im.frustumCulled = false;
      group.add(im);
    }
    const gap = 1 - this.style.terrain.tileGap;
    group.position.set(p.x + 0.5, 0.02, p.y + 0.5);
    group.scale.set(gap, 1, gap);
    for (const c of group.children) c.position.set(-0.5, 0, -0.5);
    return group;
  }

  private rebuildGhost(): void {
    if (!this.ghost) return;
    const { placement, tile } = this.ghost;
    this.overlayRoot.remove(this.ghost.group);
    this.ghost = null;
    this.setGhost(placement, tile);
  }

  // ---------------------------------------------------------------------------
  // Style / tier scene setup

  private playerColor(i: number): THREE.Color {
    const p = this.style.palette.players;
    return new THREE.Color(p[i % p.length]!);
  }

  private applyStyleScene(): void {
    const s = this.style;
    this.scene.background = new THREE.Color(s.palette.background);
    this.scene.fog = s.fog ? new THREE.FogExp2(s.fog.color, s.fog.density) : null;
    const L = s.lighting;
    this.hemi.color.set(L.hemisphere.sky);
    this.hemi.groundColor.set(L.hemisphere.ground);
    this.hemi.intensity = L.hemisphere.intensity;
    this.sun.color.set(L.sun.color);
    this.sun.intensity = L.sun.intensity;
    this.renderer.toneMapping =
      L.toneMapping === "aces" ? THREE.ACESFilmicToneMapping : L.toneMapping === "agx" ? THREE.AgXToneMapping : L.toneMapping === "neutral" ? THREE.NeutralToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = L.exposure;
    if (L.environment > 0 && !this.envTexture) {
      try {
        const pm = new THREE.PMREMGenerator(this.renderer);
        this.envTexture = pm.fromScene(new RoomEnvironment(), 0.04).texture;
        pm.dispose();
      } catch (e) {
        console.warn("[render-three] environment unavailable", e);
      }
    }
    this.scene.environment = L.environment > 0 ? this.envTexture : null;
    this.scene.environmentIntensity = L.environment;
    this.props.houseHeight = s.props.houseHeight;
    this.props.propScale = s.props.scale;
    this.boundsDirty = true;
    this.propsDirty = true;
    this.rebuildPost();
  }

  private applyTier(): void {
    const t = this.tier;
    this.renderer.shadowMap.enabled = t !== "low";
    this.sun.castShadow = t !== "low";
    const size = t === "high" ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    this.sun.shadow.radius = this.style.lighting.shadowSoftness;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.props.castShadow = t === "high";
    this.boundsDirty = true;
    this.rebuildPost();
  }

  private rebuildPost(): void {
    this.post?.dispose();
    this.post = null;
    this.postCamera = null;
  }

  private boardCentre(): [number, number] {
    const b = this.bounds();
    return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  }

  private bounds(): { minX: number; minZ: number; maxX: number; maxZ: number } {
    if (this.tiles.size === 0) return { minX: -1, minZ: -1, maxX: 2, maxZ: 2 };
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const t of this.tiles.values()) {
      minX = Math.min(minX, t.x);
      minZ = Math.min(minZ, t.y);
      maxX = Math.max(maxX, t.x + 1);
      maxZ = Math.max(maxZ, t.y + 1);
    }
    return { minX, minZ, maxX, maxZ };
  }

  private updateBounds(): void {
    const b = this.bounds();
    this.rig.setBounds(b);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 1.5;
    const L = this.style.lighting.sun;
    const az = (L.azimuth * Math.PI) / 180;
    const el = (L.elevation * Math.PI) / 180;
    const d = r * 2.5;
    this.sun.position.set(cx + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, cz + Math.cos(az) * Math.cos(el) * d);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = d * 2;
    cam.updateProjectionMatrix();
    this.table.position.set(cx, -0.092, cz);
  }

  // ---------------------------------------------------------------------------
  // Frame

  private update(dt: number): void {
    this.timeline.advance(dt);
    for (const s of this.timeline.active(this.style.anim.overshoot)) this.applyClip(s.clip, s.key, s.t, s.p);
    if (this.boundsDirty) {
      this.boundsDirty = false;
      this.updateBounds();
    }
    this.rig.update(dt);

    // tiles + props
    if (this.propsDirty) {
      for (const t of this.tiles.values()) this.tileMatrix(t);
      this.props.rebuild(this.tiles.values());
      this.propsDirty = false;
      for (const t of this.tiles.values()) t.dirty = false;
    } else {
      for (const t of this.tiles.values()) {
        if (!t.dirty) continue;
        this.tileMatrix(t);
        this.props.write(t);
        t.dirty = false;
      }
    }

    // figures
    const inst: FigureInstance[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const f of this.figures.values()) {
      const t = this.tiles.get(tkey(f.x, f.y));
      if (!t || !t.visible) continue;
      const a = t.geom.anchors[f.feature];
      if (!a) continue;
      const pose: FigurePose = f.figure === "abbot" ? "standing" : a.pose;
      const sc = a.scale * f.scale;
      p.set(a.x, a.y + f.lift, a.z).applyMatrix4(t.matrix);
      // standing figures turn their broad side toward the default (south) view
      let yaw = Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw));
      if (pose === "standing") {
        if (yaw > Math.PI / 2) yaw -= Math.PI;
        if (yaw < -Math.PI / 2) yaw += Math.PI;
        yaw *= 0.35;
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      s.set(sc * (1 - f.squash * 0.5), sc * (1 + f.squash), sc * (1 - f.squash * 0.5));
      m.compose(p, q, s);
      inst.push({ key: f.key, shape: f.figure, pose, color: this.playerColor(f.player), matrix: m.clone(), visible: f.visible && f.scale > 0.001 });
    }
    this.figuresLayer.update(inst);
  }

  private draw(): void {
    const cam = this.rig.active;
    if (this.postCamera !== cam) {
      this.post?.dispose();
      this.post = buildPost(this.renderer, this.scene, cam, this.style, this.tier);
      this.postCamera = cam;
    }
    if (this.post) this.post.pipeline.render();
    else this.renderer.render(this.scene, cam);
  }

  // ---------------------------------------------------------------------------
  // Input

  private emit(e: RendererEvent): void {
    for (const l of this.listeners) l(e);
  }

  private hoverAt(pick: PickResult | null): Placement | null {
    let placement: Placement | null = null;
    if (this.pending) {
      const p = this.pending;
      const onTile = pick && pick.cell.x === p.placement.x && pick.cell.y === p.placement.y;
      const opt = onTile && pick.feature !== null ? p.options.find((o) => o.feature === pick.feature) : undefined;
      this.setHover(opt ? { x: p.placement.x, y: p.placement.y, feature: opt.feature } : null);
      return p.placement;
    }
    if (this.hints && pick) {
      const at = this.hints.placements.filter((q) => q.x === pick.cell.x && q.y === pick.cell.y);
      if (at.length > 0) {
        const keep = this.ghost && this.ghost.placement.x === pick.cell.x && this.ghost.placement.y === pick.cell.y ? this.ghost.placement : null;
        placement = keep ?? at[0]!;
        this.setGhost(placement);
      } else this.setGhost(null);
    }
    if (pick && pick.tile && pick.feature !== null && this.tiles.has(tkey(pick.cell.x, pick.cell.y))) this.setHover({ x: pick.cell.x, y: pick.cell.y, feature: pick.feature });
    else this.setHover(null);
    return placement;
  }

  private attachInput(): () => void {
    const el = this.canvas;
    let down: { x: number; y: number; button: number; moved: boolean } | null = null;
    const move = (e: PointerEvent) => {
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
        if (down.moved) {
          if (down.button === 2 || e.shiftKey) this.rig.pan(dx, dy);
          else this.rig.orbit(dx, dy);
          down.x = e.clientX;
          down.y = e.clientY;
          return;
        }
      }
      const pick = this.pick(e.clientX, e.clientY);
      this.emit({ type: "hover", pick, placement: this.hoverAt(pick) });
    };
    const pdown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    };
    const up = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || d.moved) return;
      const pick = this.pick(e.clientX, e.clientY);
      if (pick) this.emit({ type: "click", pick, placement: this.hoverAt(pick) });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.rig.zoom(Math.exp(e.deltaY * 0.0012));
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", pdown);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", ctx);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", pdown);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", ctx);
    };
  }
}
