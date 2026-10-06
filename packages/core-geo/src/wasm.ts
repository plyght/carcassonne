// Thin wrapper over the geo/anim exports of core.wasm. It accepts an already
// instantiated module (the same instance packages/core-wasm uses for the
// engine), so the app ships a single wasm.
import type { EngineEvent } from "@carcassonne/protocol";
import type { AnimOptions, AnimTimeline } from "./anim";
import { decodeGeo2D, decodeGeo3D, decodeGeoFigure, decodeGeoProp, type GeoFigure, type GeoPropModel, type GeoTile2D, type GeoTile3D } from "./decode";
import { PROPS, PROP_VARIANTS, type FigurePose, type FigureShape, type PropKind } from "./format";

export interface CoreGeoExports {
  memory: WebAssembly.Memory;
  core_alloc(len: number): number;
  core_free(ptr: number, len: number): void;
  geo_tile_count(): number;
  geo_tile_index(idPtr: number, idLen: number): number;
  geo_tile_id(index: number): number;
  geo_tile_2d(index: number): number;
  geo_tile_3d(index: number, resolution: number, slabPermille: number): number;
  geo_figure(kind: number, pose: number): number;
  geo_prop(kind: number, variant: number, flags: number): number;
  anim_timeline(evPtr: number, evLen: number, optPtr: number, optLen: number): number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class CoreGeo {
  readonly exports: CoreGeoExports;
  private cache2d = new Map<string, GeoTile2D>();
  private cacheProps = new Map<string, GeoPropModel>();

  constructor(source: WebAssembly.Instance | CoreGeoExports) {
    this.exports = (source instanceof WebAssembly.Instance ? source.exports : source) as unknown as CoreGeoExports;
  }

  static async instantiate(bytes: BufferSource): Promise<CoreGeo> {
    const module = await WebAssembly.compile(bytes);
    return new CoreGeo(await WebAssembly.instantiate(module, {}));
  }

  /** Copies a `[u32 len][bytes]` result out of wasm memory and frees it. */
  private take(ptr: number): Uint8Array {
    if (ptr === 0) throw new Error("core.wasm geo call failed");
    const mem = new Uint8Array(this.exports.memory.buffer);
    const len = (mem[ptr]! | (mem[ptr + 1]! << 8) | (mem[ptr + 2]! << 16) | (mem[ptr + 3]! << 24)) >>> 0;
    const out = mem.slice(ptr + 4, ptr + 4 + len); // fresh, aligned copy
    this.exports.core_free(ptr, 4 + len);
    return out;
  }

  private withBytes<T>(data: Uint8Array, f: (ptr: number, len: number) => T): T {
    const len = data.length;
    const ptr = len > 0 ? this.exports.core_alloc(len) : 0;
    if (len > 0) {
      if (!ptr) throw new Error("core_alloc failed");
      new Uint8Array(this.exports.memory.buffer, ptr, len).set(data);
    }
    try {
      return f(ptr, len);
    } finally {
      if (len > 0) this.exports.core_free(ptr, len);
    }
  }

  get tileCount(): number {
    return this.exports.geo_tile_count();
  }

  tileIds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.tileCount; i++) out.push(dec.decode(this.take(this.exports.geo_tile_id(i))));
    return out;
  }

  indexOf(id: string): number {
    return this.withBytes(enc.encode(id), (p, l) => this.exports.geo_tile_index(p, l));
  }

  private resolve(tile: string | number): number {
    const i = typeof tile === "number" ? tile : this.indexOf(tile);
    if (i < 0 || i >= this.tileCount) throw new Error(`unknown tile ${tile}`);
    return i;
  }

  tile2dBytes(tile: string | number): Uint8Array {
    return this.take(this.exports.geo_tile_2d(this.resolve(tile)));
  }

  /** `slab`: thickness in tile units (default 0.09; 0 = no slab). */
  tile3dBytes(tile: string | number, resolution = 0, slab?: number): Uint8Array {
    const permille = slab === undefined ? 0 : slab <= 0 ? 0xffffffff : Math.round(slab * 1000);
    return this.take(this.exports.geo_tile_3d(this.resolve(tile), resolution, permille));
  }

  /** Decoded 2D geometry (cached per tile id; geometry is immutable). */
  tile2d(tile: string | number): GeoTile2D {
    const key = String(tile);
    let g = this.cache2d.get(key);
    if (!g) {
      g = decodeGeo2D(this.tile2dBytes(tile));
      this.cache2d.set(key, g);
    }
    return g;
  }

  tile3d(tile: string | number, resolution = 0, slab?: number): GeoTile3D {
    return decodeGeo3D(this.tile3dBytes(tile, resolution, slab));
  }

  /** Classic meeple / abbot piece: 2D outline token + bevelled 3D mesh (height 1). */
  figure(shape: FigureShape = "meeple", pose: FigurePose = "standing"): GeoFigure {
    const k = shape === "abbot" ? 1 : 0;
    const p = pose === "lying" ? 1 : 0;
    return decodeGeoFigure(this.take(this.exports.geo_figure(k, p)));
  }

  /**
   * Procedural prop model for (kind, variant % PROP_VARIANTS[kind]); `rounded` selects the
   * smoother toon-style models. Cached (models are immutable; don't mutate the arrays).
   */
  prop(kind: PropKind, variant = 0, options: { rounded?: boolean } = {}): GeoPropModel {
    const v = variant % PROP_VARIANTS[kind];
    const rounded = options.rounded === true;
    const key = `${kind}:${v}:${rounded ? 1 : 0}`;
    let m = this.cacheProps.get(key);
    if (!m) {
      const k = PROPS.indexOf(kind);
      if (k < 0) throw new Error(`unknown prop ${kind}`);
      m = decodeGeoProp(this.take(this.exports.geo_prop(k, v, rounded ? 1 : 0)));
      this.cacheProps.set(key, m);
    }
    return m;
  }

  animTimeline(events: EngineEvent[], options: AnimOptions = {}): AnimTimeline {
    const ev = enc.encode(JSON.stringify(events));
    const op = enc.encode(JSON.stringify(options));
    const out = this.withBytes(ev, (ep, el) => this.withBytes(op, (op2, ol) => this.take(this.exports.anim_timeline(ep, el, op2, ol))));
    return JSON.parse(dec.decode(out)) as AnimTimeline;
  }
}
