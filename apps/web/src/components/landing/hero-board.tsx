"use client";

// Poster first, live board second. The poster (an offline render of the exact first
// frame) is the LCP image; after load + idle, capable desktops swap in the real game:
// four Medium bots replaying a recorded match through core.wasm, one tile every few
// seconds, under a slowly swaying camera. Reduced motion, phones, software GL and
// save-data keep the poster.

import { useEffect, useRef, useState } from "react";

import type { GameView } from "@carcassonne/protocol";
import { FigureIcon } from "@carcassonne/render-classic";

import { probeGpu } from "@/components/board3d/capabilities";

import { HERO_WIDE } from "./framing";
import { useInView } from "./use-in-view";

/** The panel colour the posters were rendered on (keep in sync with landing.css). */
export const HERO_TABLE = "#342619";

const SEATS = [
  { name: "Red", fill: "#d0261c", ink: "#fff7ec", marker: "circle" as const },
  { name: "Blue", fill: "#2650c0", ink: "#f2f7ff", marker: "square" as const },
  { name: "Yellow", fill: "#f0c419", ink: "#3a2a00", marker: "triangle" as const },
  { name: "Green", fill: "#2d8a37", ink: "#effff5", marker: "diamond" as const },
];

const TOTAL_TILES = 84;

type Phase = "poster" | "loading" | "live" | "fading";

function liveAllowed(): boolean {
  const q = new URLSearchParams(window.location.search);
  if (q.get("live") === "0") return false;
  const forced = q.get("live") === "1";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (document.documentElement.dataset.reducedMotion === "true") return false;
  if (!forced && !window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  const gpu = probeGpu();
  if (!gpu.webgl2 || gpu.mobile) return false;
  if (!forced && gpu.gpu && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu.gpu)) return false;
  return true;
}

function pickTier(): "high" | "medium" {
  const gpu = probeGpu().gpu ?? "";
  return /apple|nvidia|geforce|radeon|amd|rtx|quadro/i.test(gpu) ? "high" : "medium";
}

export function HeroBoard() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<import("./live-runtime").LiveBoard | null>(null);
  const [phase, setPhase] = useState<Phase>("poster");
  const [view, setView] = useState<GameView | null>(null);
  const inView = useInView(stageRef, { threshold: 0.05 });

  useEffect(() => {
    if (!liveAllowed()) return;
    let alive = true;
    let idle = 0;
    const begin = () => {
      const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
      idle = ric(() => void boot(), { timeout: 2500 } as IdleRequestOptions) as number;
    };
    const boot = async () => {
      const canvas = canvasRef.current;
      if (!alive || !canvas) return;
      setPhase("loading");
      try {
        const mod = await import("./live-runtime");
        if (!alive) return;
        const live = await mod.startLive({
          canvas,
          table: HERO_TABLE,
          spec: HERO_WIDE,
          tier: pickTier(),
          onFirstFrame: () => alive && setPhase("live"),
          onView: (v) => alive && setView(v),
          onRestart: () => {
            if (!alive) return;
            setPhase("fading");
            window.setTimeout(() => {
              liveRef.current?.restart();
              alive && setPhase("live");
            }, 700);
          },
        });
        if (!alive) return live.dispose();
        liveRef.current = live;
      } catch (e) {
        console.warn("[landing] live board unavailable, keeping the poster:", (e as Error).message);
        if (alive) setPhase("poster");
      }
    };
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });
    return () => {
      alive = false;
      window.removeEventListener("load", begin);
      if (idle) (window.cancelIdleCallback ?? window.clearTimeout)(idle);
      liveRef.current?.dispose();
      liveRef.current = null;
    };
  }, []);

  // only render while the hero is on screen and the tab is visible
  useEffect(() => {
    const sync = () => liveRef.current?.setVisible(inView && document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [inView, phase]);

  const live = phase === "live";
  const placed = view ? view.board.length : 0;

  return (
    <div ref={stageRef} className="lp-stage" data-phase={phase}>
      <picture className="lp-poster">
        <source media="(max-width: 767px)" srcSet="/landing/hero-narrow-716.webp 716w, /landing/hero-narrow-1074.webp 1074w" sizes="100vw" />
        <img
          src="/landing/hero-wide-1248.webp"
          srcSet="/landing/hero-wide-1248.webp 1248w, /landing/hero-wide-2496.webp 2496w"
          sizes="(min-width: 1280px) 1248px, 100vw"
          alt="A Carcassonne board in progress: walled red-roofed cities, roads and a river across green tiles, with coloured meeples claiming them."
          fetchPriority="high"
          decoding="async"
          width={2496}
          height={1592}
        />
      </picture>
      <canvas ref={canvasRef} className="lp-canvas" aria-hidden="true" />
      <div className="lp-live" aria-live="off" data-on={live || phase === "fading" ? "true" : undefined}>
        <span className="lp-live-dot" aria-hidden="true" />
        <span className="lp-live-label">
          Four bots, live <span className="lp-live-sep">·</span> <span className="carc-num">tile {Math.min(placed, TOTAL_TILES)} of {TOTAL_TILES}</span>
        </span>
        <span className="lp-live-scores">
          {SEATS.map((s, i) => (
            <span key={s.name} className="lp-live-score" title={`${s.name}: ${view?.players[i]?.score ?? 0} points`}>
              <FigureIcon fill={s.fill} ink={s.ink} marker={s.marker} size={18} outline="rgba(0,0,0,0.45)" />
              <span className="carc-num">{view?.players[i]?.score ?? 0}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
