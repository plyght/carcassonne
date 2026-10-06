// Live tuning hooks (additive; no three.js import, so an app can load this eagerly).
//
// Style overrides: a style pack is data, so tuning is "merge a patch, validate it,
// hand the result to `BoardRenderer.setStyle(pack)`" (`applyStyleOverrides`,
// `setStyleOverrides`), and exporting is `stylePackJSON` (paste into
// packages/assets/styles/<id>/style.json).
//
// Animation overrides: the core/anim timeline (Zig) is the source of truth for clip
// order and timing. `withAnimTuning` wraps the renderer's GeoProvider so every
// timeline it plays is retimed per clip kind: start offset, duration, easing curve
// (spring or cubic-bezier, sampled the same way DialKit's timeline dock samples them)
// and params (drop height, hop height). Clip-relative scaling is kept, so cartoon /
// final-scoring pacing and the playback `speed` still apply; reduced-motion clips
// (duration 0) are left alone.
import { EASINGS, type AnimClip, type AnimOptions, type AnimTimeline, type ClipKind, type ClipParams, type EasingId } from "@carcassonne/core-geo/anim";
import type { EngineEvent } from "@carcassonne/protocol";
import { getStylePack, loadStylePack, type StylePack } from "./styles";

// ── style packs ─────────────────────────────────────────────────────────────

type Patch<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? Patch<NonNullable<T[K]>> | null : T[K] };
export type StylePatch = Patch<Omit<StylePack, "id" | "name">>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isObj(patch) || !isObj(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

/** `pack` with `patch` merged in, validated like a style.json (throws StylePackError). */
export function applyStyleOverrides(pack: StylePack, patch: StylePatch): StylePack {
  return loadStylePack(deepMerge(pack, patch));
}

/** Apply a patch over a built-in pack on a live renderer (via `setStyle(pack)`). */
export function setStyleOverrides(renderer: { setStyle(style: StylePack | string): void; readonly styleId: string }, patch: StylePatch, base?: StylePack): StylePack {
  const pack = applyStyleOverrides(base ?? getStylePack(renderer.styleId), patch);
  renderer.setStyle(pack);
  return pack;
}

/** A pack as style.json text (same key order as the files in packages/assets/styles). */
export function stylePackJSON(pack: StylePack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

// ── transitions (DialKit-compatible sampling) ──────────────────────────────

export type TuneTransition =
  | { type: "spring"; visualDuration?: number; bounce?: number; stiffness?: number; damping?: number; mass?: number }
  | { type: "easing"; duration: number; ease: [number, number, number, number] };

interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

function isPhysics(t: TuneTransition): boolean {
  return t.type === "spring" && (t.stiffness !== undefined || t.damping !== undefined || t.mass !== undefined);
}

/** Motion's visualDuration/bounce → stiffness/damping mapping (as DialKit does). */
function springParams(t: Extract<TuneTransition, { type: "spring" }>, visualDuration: number): SpringParams {
  if (isPhysics(t)) return { stiffness: t.stiffness ?? 200, damping: t.damping ?? 25, mass: t.mass ?? 1 };
  const vd = Math.max(0.05, visualDuration);
  const bounce = t.bounce ?? 0.2;
  const root = (2 * Math.PI) / (vd * 1.2);
  const stiffness = root * root;
  return { stiffness, damping: 2 * Math.min(1, Math.max(0.05, 1 - bounce)) * Math.sqrt(stiffness), mass: 1 };
}

function springProgress(t: number, { stiffness, damping, mass }: SpringParams): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 0.9999) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta < 1.0001) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + wd;
  const r2 = -zeta * w0 - wd;
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

function settle(p: SpringParams): number {
  const w0 = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  const decay = zeta >= 1 ? zeta * w0 - w0 * Math.sqrt(Math.max(0, zeta * zeta - 1)) : zeta * w0;
  return Math.min(10, Math.max(0.05, Math.log(200) / Math.max(decay, 1e-6)));
}

function bezier(p: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const ax = (t: number, a1: number, a2: number) => (1 - 3 * a2 + 3 * a1) * t * t * t + (3 * a2 - 6 * a1) * t * t + 3 * a1 * t;
  let lo = 0;
  let hi = 1;
  let t = p;
  for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
    if (ax(t, x1, x2) < p) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return ax(t, y1, y2);
}

/**
 * A clip curve: `duration` is the bar length (visual duration for time springs);
 * `total` is how long the clip must run to settle (a bouncy spring's tail).
 * `at(u)` is eased progress for linear clip time u ∈ [0, 1] over `total`.
 */
export function sampleTransition(tr: TuneTransition | undefined, duration: number): { total: number; at(u: number): number } {
  if (!tr) return { total: duration, at: (u) => u };
  if (tr.type === "easing") return { total: duration, at: (u) => bezier(u, tr.ease) };
  const params = springParams(tr, duration);
  const total = isPhysics(tr) ? settle(params) : Math.max(duration, Math.min(settle(params), duration * 2.2));
  return { total, at: (u) => (u >= 1 ? 1 : springProgress(u * total, params)) };
}

/** A DialKit transition that resembles a core easing id (used to seed the timeline). */
export function transitionForEasing(id: EasingId, duration: number): TuneTransition {
  switch (id) {
    case "easeOutCubic":
      return { type: "easing", duration, ease: [0.33, 1, 0.68, 1] };
    case "easeInOutCubic":
      return { type: "easing", duration, ease: [0.65, 0, 0.35, 1] };
    case "easeInCubic":
      return { type: "easing", duration, ease: [0.32, 0, 0.67, 0] };
    case "easeOutBack":
      return { type: "spring", visualDuration: duration, bounce: 0.35 };
    case "easeOutBounce":
      return { type: "spring", visualDuration: duration, bounce: 0.5 };
    case "easeOutElastic":
      return { type: "spring", visualDuration: duration, bounce: 0.65 };
    default:
      return { type: "easing", duration, ease: [0, 0, 1, 1] };
  }
}

// ── anim timeline ───────────────────────────────────────────────────────────

export interface ClipTuning {
  /** Start, seconds, on the reference timeline (see `referenceEvents`). */
  at: number;
  /** Bar length, seconds. */
  duration: number;
  transition?: TuneTransition;
  params?: Partial<Pick<ClipParams, "fromHeight" | "hopHeight" | "squash">>;
}
export type AnimTuning = Partial<Record<ClipKind, ClipTuning>>;

/** Base timing of the first clip of each kind on a timeline. */
export type ClipBase = { at: number; duration: number; easing: EasingId; params: ClipParams };

/** One representative move: a city tile drops, a meeple hops on, the city scores and the meeple hops home. */
export const REFERENCE_EVENTS: EngineEvent[] = [
  { type: "tilePlaced", player: 0, x: 1, y: 0, rot: 1, tile: "E" },
  { type: "figurePlaced", player: 0, x: 1, y: 0, feature: 0, figure: "meeple" },
  { type: "featureScored", kind: "city", cells: [[1, 0], [0, 0]], winners: [0], points: 4, returned: [{ player: 0, x: 1, y: 0, feature: 0, figure: "meeple" }], final: false },
];

export function clipBases(tl: AnimTimeline): Partial<Record<ClipKind, ClipBase>> {
  const out: Partial<Record<ClipKind, ClipBase>> = {};
  for (const c of tl.clips) out[c.kind] ??= { at: c.start, duration: c.duration, easing: c.easing, params: { ...c.params } };
  return out;
}

/** Retime a core/anim timeline with per-kind tuning relative to `bases` (reference timings). */
export function retimeTimeline(tl: AnimTimeline, tuning: AnimTuning, bases: Partial<Record<ClipKind, ClipBase>>): AnimTimeline {
  const registry = EASINGS as Record<string, (t: number) => number>;
  const curves = new Map<ClipKind, { id: string; total: number }>();
  const clips: AnimClip[] = tl.clips.map((c) => {
    const tune = tuning[c.kind];
    const base = bases[c.kind];
    if (!tune || !base || c.duration <= 0 || base.duration <= 0) return c;
    const scale = c.duration / base.duration;
    let curve = curves.get(c.kind);
    if (!curve) {
      const s = sampleTransition(tune.transition, tune.duration);
      const id = `tune:${c.kind}:${JSON.stringify([tune.transition, tune.duration])}`;
      registry[id] = s.at;
      curve = { id, total: s.total };
      curves.set(c.kind, curve);
    }
    const params = { ...c.params };
    for (const [k, v] of Object.entries(tune.params ?? {})) if (typeof v === "number" && k in params) (params as Record<string, number>)[k] = v;
    return {
      ...c,
      start: Math.max(0, c.start + (tune.at - base.at) * scale),
      duration: Math.max(0.01, curve.total * scale),
      easing: (tune.transition ? curve.id : c.easing) as EasingId,
      params,
    };
  });
  const duration = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  return { ...tl, duration, clips };
}

/** What the renderer needs from a geo provider for animation. */
export interface AnimSource {
  animTimeline(events: EngineEvent[], options?: AnimOptions): AnimTimeline;
}

/**
 * Wrap a GeoProvider (e.g. CoreGeo) so its timelines are retimed by whatever
 * `get()` returns at play time (null = untouched). Other methods pass through.
 */
export function withAnimTuning<G extends AnimSource>(geo: G, get: () => { tuning: AnimTuning; bases: Partial<Record<ClipKind, ClipBase>> } | null): G {
  return new Proxy(geo, {
    get(target, prop, receiver) {
      if (prop === "animTimeline") {
        return (events: EngineEvent[], options?: AnimOptions) => {
          const tl = target.animTimeline(events, options);
          const t = get();
          return t ? retimeTimeline(tl, t.tuning, t.bases) : tl;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
