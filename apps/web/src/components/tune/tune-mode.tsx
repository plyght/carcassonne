"use client";

// ?tune: DialKit panels over the live game.
//   • 3D styles: every field of the active style pack (lighting, palette, materials,
//     terrain, props, anim intensity, post FX, popups, fog), applied live through
//     BoardRenderer.setStyle(pack) (see lib/tuning + board-3d), exportable as style.json.
//   • 2D styles: the Classic / Blueprint palette, applied live to the SVG board,
//     exportable as the TS literal for render-classic/src/palette.ts.
//   • 3D styles also get the core/anim clips (tile drop / rise, wall extrude, meeple hops, score pulse and
//     popup, camera focus) as a DialKit timeline: scrub, retime and reshape the curves;
//     the board's next animations play with the edits.

import { useEffect, useMemo, useRef, useState } from "react";

import { DialRoot, DialTimeline, useDialKitController, useDialTimeline, type TimelineConfig } from "dialkit";
import { toast } from "sonner";

import type { ClipKind } from "@carcassonne/core-geo/anim";
import { FigureIcon, PLAYER_COLORS, type BoardPalette, type StylePack as ClassicStyle } from "@carcassonne/render-classic";
import { paletteSource, tunePalette } from "@carcassonne/render-classic/palette-tune";
import { getStylePack, loadStylePack, type StylePack } from "@carcassonne/render-three/styles";
import { clipBases, REFERENCE_EVENTS, stylePackJSON, transitionForEasing, type AnimTuning, type ClipBase, type TuneTransition } from "@carcassonne/render-three/tuning";

import { useDialTheme } from "@/components/dial/primitives";
import { useCore } from "@/lib/core";
import { tuneStore } from "@/lib/tuning";

import { packConfig, packFromValues, paletteConfig, paletteFromValues } from "./schema";

declare global {
  interface Window {
    /** Test hook: the last ?tune export (file name + text). */
    __carcTuneExport?: { name: string; text: string };
  }
}

async function exportText(name: string, text: string, download: boolean) {
  window.__carcTuneExport = { name, text };
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    /* clipboard needs permission / focus; fall back to a download */
  }
  if (download || !copied) {
    const url = URL.createObjectURL(new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  toast.success(copied ? `${name} copied` : `${name} downloaded`, { description: name.endsWith(".json") ? "Paste over packages/assets/styles/<id>/style.json" : "Paste over the constant in render-classic/src/palette.ts" });
}

// ── style pack panel ─────────────────────────────────────────────────────────

function StylePackPanel({ id }: { id: string }) {
  const base = useMemo(() => getStylePack(id), [id]);
  const config = useMemo(() => packConfig(base), [base]);
  const latest = useRef<StylePack>(base);
  const dial = useDialKitController(`Style · ${base.name}`, config, {
    id: `tune-style-${id}`,
    onAction: (path) => {
      if (path === "export.copy" || path === "export.download") void exportText("style.json", stylePackJSON(latest.current), path === "export.download");
      if (path === "export.reset") {
        dial.resetValues();
        tuneStore.setPack(id, null);
      }
    },
  });
  const key = JSON.stringify(dial.values);
  const warned = useRef("");
  useEffect(() => {
    try {
      const pack = loadStylePack(packFromValues(base, dial.values as unknown as Record<string, unknown>));
      latest.current = pack;
      tuneStore.setPack(id, JSON.stringify(pack) === JSON.stringify(base) ? null : pack);
    } catch (e) {
      const msg = (e as Error).message;
      if (warned.current !== msg) toast.error("Style pack rejected", { description: msg });
      warned.current = msg;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base, id]);
  useEffect(() => () => tuneStore.setPack(id, null), [id]);
  return null;
}

// ── 2D palette panel ─────────────────────────────────────────────────────────

const PALETTE_CONST: Record<string, string> = { classic: "CLASSIC_PALETTE", blueprint: "BLUEPRINT_PALETTE" };

function PalettePanel({ base }: { base: BoardPalette }) {
  const config = useMemo(() => paletteConfig(base), [base]);
  const latest = useRef<BoardPalette>(base);
  const rev = useRef(0);
  const dial = useDialKitController(`Palette · ${base.id}`, config, {
    id: `tune-palette-${base.id}`,
    onAction: (path) => {
      if (path === "export.copy") void exportText(`${base.id}-palette.ts`, paletteSource(latest.current, PALETTE_CONST[base.id] ?? "PALETTE"), false);
      if (path === "export.reset") {
        dial.resetValues();
        tuneStore.setPalette(base.id, null);
      }
    },
  });
  const key = JSON.stringify(dial.values);
  useEffect(() => {
    // repainting every tile bitmap is not free: settle for a moment before applying
    const t = setTimeout(() => {
      const patch = paletteFromValues(base, dial.values as unknown as Record<string, unknown>);
      const tuned = tunePalette(base, patch, ++rev.current);
      latest.current = tuned;
      const { id: _a, ...a } = tuned;
      const { id: _b, ...b } = base;
      tuneStore.setPalette(base.id, JSON.stringify(a) === JSON.stringify(b) ? null : tuned);
    }, 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base]);
  useEffect(() => () => tuneStore.setPalette(base.id, null), [base.id]);
  return null;
}

// ── anim timeline ────────────────────────────────────────────────────────────

/** Timeline clip → core/anim clip kind, with the value each clip animates. */
const CLIPS: { group: string; clip: string; kind: ClipKind; prop: string; from: (b: ClipBase) => number; to: number; param?: "fromHeight" | "hopHeight" }[] = [
  { group: "tile", clip: "drop", kind: "tileDrop", prop: "height", from: (b) => b.params.fromHeight ?? 0.6, to: 0, param: "fromHeight" },
  { group: "tile", clip: "rise", kind: "lifeRise", prop: "rise", from: () => 0, to: 1 },
  { group: "tile", clip: "walls", kind: "wallExtrude", prop: "walls", from: () => 0, to: 1 },
  { group: "meeple", clip: "hopIn", kind: "meepleHopIn", prop: "hop", from: (b) => b.params.hopHeight ?? 0.25, to: 0, param: "hopHeight" },
  { group: "meeple", clip: "hopOut", kind: "meepleHopOut", prop: "hop", from: () => 0, to: 1 },
  { group: "score", clip: "pulse", kind: "featurePulse", prop: "glow", from: () => 0, to: 1 },
  { group: "score", clip: "popup", kind: "scorePopup", prop: "pop", from: () => 0, to: 1 },
  { group: "camera", clip: "focus", kind: "cameraFocus", prop: "focus", from: () => 0, to: 1 },
];

type ClipValues = { at: number; duration: number; transition?: TuneTransition; from?: Record<string, number>; current?: Record<string, number> };

function useAnimTimeline(styleId: string, preset: "realistic" | "cartoon") {
  const core = useCore();
  const { bases, config } = useMemo(() => {
    if (!core) return { bases: null, config: null };
    const tl = core.geo.animTimeline(REFERENCE_EVENTS, { style: preset, speed: 1 });
    const bases = clipBases(tl);
    const config: Record<string, Record<string, unknown>> = {};
    for (const c of CLIPS) {
      const b = bases[c.kind];
      if (!b) continue;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      (config[c.group] ??= {})[c.clip] = {
        at: round(b.at),
        duration: round(b.duration),
        from: { [c.prop]: round(c.from(b)) },
        to: { [c.prop]: c.to },
        transition: transitionForEasing(b.easing, round(b.duration)),
      };
    }
    return { bases, config: { duration: Math.ceil(tl.duration * 10) / 10 + 0.2, ...config } as TimelineConfig };
  }, [core, preset]);
  return { bases, config, key: `${styleId}:${preset}` };
}

function AnimTimelinePanel({ bases, config, name }: { bases: Partial<Record<ClipKind, ClipBase>>; config: TimelineConfig; name: string }) {
  const tl = useDialTimeline(name, config, { id: `tune-anim-${name}`, autoplay: false, loop: true }) as unknown as Record<string, Record<string, ClipValues>>;
  const seed = useRef<string | null>(null);
  // the edited clips (vs the seeded config) become the board's anim tuning
  const tuning: AnimTuning = {};
  for (const c of CLIPS) {
    const v = tl[c.group]?.[c.clip];
    if (!v) continue;
    tuning[c.kind] = {
      at: v.at,
      duration: v.duration,
      transition: v.transition,
      params: c.param ? { [c.param]: v.from?.[c.prop] } : undefined,
    };
  }
  const key = JSON.stringify(tuning);
  seed.current ??= key;
  useEffect(() => {
    if (key === seed.current) return tuneStore.setAnim(null);
    const seeded = JSON.parse(seed.current!) as AnimTuning;
    const changed: AnimTuning = {};
    for (const [k, v] of Object.entries(JSON.parse(key) as AnimTuning)) if (JSON.stringify(v) !== JSON.stringify(seeded[k as ClipKind])) changed[k as ClipKind] = v;
    tuneStore.setAnim({ tuning: changed, bases });
  }, [key, bases]);
  useEffect(() => () => tuneStore.setAnim(null), []);

  // keep the preview stage just above the dock (which the user can resize or hide)
  const [dockTop, setDockTop] = useState(0);
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    const attach = () => {
      const dock = document.querySelector(".dialkit-timeline");
      if (!dock) return false;
      const measure = () => setDockTop((dock as HTMLElement).hidden ? 0 : dock.getBoundingClientRect().height);
      ro = new ResizeObserver(measure);
      ro.observe(dock);
      measure();
      return true;
    };
    const t = setInterval(() => attach() && clearInterval(t), 200);
    return () => {
      clearInterval(t);
      ro?.disconnect();
    };
  }, []);

  // a tiny stage bound to the playhead (clip.current), so scrubbing previews the curves
  const cur = (g: string, c: string, p: string) => tl[g]?.[c]?.current?.[p] ?? 0;
  const drop = cur("tile", "drop", "height");
  const rise = cur("tile", "rise", "rise");
  const hopIn = cur("meeple", "hopIn", "hop");
  const hopOut = cur("meeple", "hopOut", "hop");
  const pop = cur("score", "popup", "pop");
  const glow = cur("score", "pulse", "glow");
  const red = PLAYER_COLORS.red;
  return (
    <div className="pointer-events-none fixed right-4 z-[9997]" style={{ bottom: dockTop + 24 }} data-testid="tune-stage" aria-hidden>
      <div className="carc-tune-stage" style={{ boxShadow: "0 18px 40px -20px rgba(60,35,10,0.55), 0 0 0 1px var(--border)", background: "var(--card)" }}>
        <div className="carc-eyebrow absolute top-2 left-3">Clip preview</div>
        <div className="absolute inset-x-0 bottom-0 h-6" style={{ background: "color-mix(in oklch, var(--wood) 30%, var(--card))" }} />
        <div
          className="absolute bottom-4 left-1/2 h-9 w-16 -translate-x-1/2 rounded-sm"
          style={{
            transform: `translate(-50%, ${-drop * 70}px)`,
            background: "linear-gradient(135deg, #86bf35, #6fa52c)",
            boxShadow: `0 ${4 + drop * 10}px ${6 + drop * 14}px -4px rgba(40,25,10,${0.5 - drop * 0.3}), 0 0 0 ${glow * 3}px rgba(255,236,160,${Math.sin(Math.PI * Math.min(1, glow)) * 0.9})`,
          }}
        >
          <div className="absolute bottom-full left-2 h-3 w-5 origin-bottom rounded-t-sm bg-[#e8dcc0]" style={{ transform: `scaleY(${Math.max(0, rise)})` }} />
          <div className="absolute bottom-[60%] right-2 origin-bottom" style={{ transform: `translateY(${-(hopIn * 48 + Math.sin(Math.PI * Math.min(1, hopOut)) * 14)}px) scale(${1 - Math.max(0, hopOut - 0.5) * 2})` }}>
            <FigureIcon fill={red.fill} ink={red.ink} marker={red.marker} size={18} />
          </div>
        </div>
        <div
          className="absolute top-6 left-1/2 font-display text-lg font-bold text-[#7a5414]"
          style={{ transform: `translate(-50%, ${12 - pop * 14}px) scale(${0.6 + Math.min(1.2, pop) * 0.5})`, opacity: pop > 0.01 && pop < 0.98 ? 1 : 0 }}
        >
          +4
        </div>
      </div>
    </div>
  );
}

// ── root ─────────────────────────────────────────────────────────────────────

export function TuneMode({ style, palette }: { style: ClassicStyle; palette: BoardPalette }) {
  const theme = useDialTheme();
  const is3d = style.renderer === "three";
  const preset = is3d ? getStylePack(style.id).anim.preset : "realistic";
  const anim = useAnimTimeline(style.id, preset);
  useEffect(() => {
    document.documentElement.dataset.tune = is3d ? "3d" : "2d";
    return () => void delete document.documentElement.dataset.tune;
  }, [is3d]);
  return (
    <div data-testid="tune-mode" data-tune-style={style.id}>
      {is3d ? <StylePackPanel key={style.id} id={style.id} /> : <PalettePanel key={palette.id.replace(/~.*$/, "")} base={basePalette(style, palette)} />}
      {is3d && anim.bases && anim.config ? <AnimTimelinePanel key={anim.key} bases={anim.bases} config={anim.config} name={`Anim · ${style.name}`} /> : null}
      <DialRoot productionEnabled position="top-left" theme={theme} />
      {is3d ? <DialTimeline productionEnabled theme={theme} defaultOpen /> : null}
    </div>
  );
}

/** The shipped palette (the board may already be showing a tuned copy). */
function basePalette(style: ClassicStyle, shown: BoardPalette): BoardPalette {
  return style.palette ?? { ...shown, id: shown.id.replace(/~.*$/, "") };
}
