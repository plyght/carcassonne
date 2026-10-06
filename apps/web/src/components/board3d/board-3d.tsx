"use client";

// React host for @carcassonne/render-three. The renderer and three.js are loaded with a
// dynamic import the first time a 3D style mounts, so 2D-only players never download
// them. The component owns the renderer's lifetime (disposed on unmount) and maps its
// pointer events to cell / feature callbacks; the game logic stays in GameScreen, the
// same as for the 2D ClassicBoard.

import { useEffect, useRef, useState, type MutableRefObject } from "react";

import type { CoreGeo } from "@carcassonne/core-geo";
import type { NodeRef } from "@carcassonne/game-client";
import type { EngineEvent, FigureOption, GameView, Placement, TileId } from "@carcassonne/protocol";
import type { BoardCommands, CameraMode, Cell, StyleId } from "@carcassonne/render-classic";
import type { PickResult, RendererEvent, RendererStats } from "@carcassonne/render-three";
import { withAnimTuning } from "@carcassonne/render-three/tuning";
import { cn } from "@carcassonne/ui/lib/utils";
import { Maximize, Minus, Plus } from "lucide-react";

import { tuneStore, useTunedPack } from "@/lib/tuning";

import { detectTier, probeGpu, type Tier3D } from "./capabilities";
import type { BoardRenderer } from "./runtime";

type ThreeCamera = "top" | "tabletop" | "orbit" | "cinematic";
const toThree = (c: CameraMode): ThreeCamera => (c === "top-down" ? "top" : c);
const fromThree = (c: ThreeCamera): CameraMode => (c === "top" ? "top-down" : c);

export interface Board3DBatch {
  seq: number;
  events: EngineEvent[];
}

export interface Board3DProps {
  geo: CoreGeo;
  styleId: StyleId;
  camera: CameraMode;
  /** The renderer changed camera on its own (dragging switches to free orbit). */
  onCameraChange?(camera: CameraMode): void;
  tier: "auto" | Tier3D;
  reducedMotion: boolean;
  /** FPS / renderer stats overlay. */
  debug?: boolean;
  view: GameView;
  /**
   * Event batches, oldest first, with increasing `seq`. Batches newer than the last seen
   * one are animated (anim timeline); a view change without new batches snaps.
   */
  batches?: readonly Board3DBatch[];
  /** Palette slot (PLAYER_COLOR_ORDER index) for each player. */
  playerSlots?: number[];
  /** Legal placements for the tile in hand: glowing spots + ghost on hover. */
  hints?: { tile: TileId; placements: Placement[] } | null;
  /** Ghost the app wants shown (keyboard cursor, hint, snapped rotation). */
  ghost?: Placement | null;
  /** Tile placed, waiting for the figure choice: feature hotspots on the ghost. */
  pending?: { placement: Placement; options: FigureOption[]; tile: TileId } | null;
  commandsRef?: MutableRefObject<BoardCommands | null>;
  onCellHover?(cell: Cell | null): void;
  onFeatureHover?(node: NodeRef | null): void;
  onCellClick?(cell: Cell, pick: PickResult, at: { x: number; y: number }): void;
  onRotate?(dir: 1 | -1): void;
  onFail?(reason: string): void;
  /** Zoom / reframe buttons (default on). */
  controls?: boolean;
  /** HUD panels over the board (px per side): framed cameras keep the board clear of them. */
  insets?: { top: number; right: number; bottom: number; left: number };
  ariaLabel: string;
  className?: string;
}

declare global {
  interface Window {
    /** Test / debug hook: the live 3D board. */
    __carc3d?: { renderer: BoardRenderer; project(x: number, y: number): { x: number; y: number } } | null;
  }
}

export function Board3D(props: Board3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<BoardRenderer | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<(RendererStats & { gpu: string | null }) | null>(null);
  useEffect(() => {
    propsRef.current = props;
  });

  // ── lifetime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let r: BoardRenderer | null = null;
    let offEvents: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const fail = (reason: string) => alive && propsRef.current.onFail?.(reason);
    void (async () => {
      const probe = probeGpu();
      if (!probe.webgl2) return fail("WebGL2 is not available on this device");
      let mod: typeof import("./runtime");
      try {
        mod = await import("./runtime");
      } catch (e) {
        return fail(`Couldn’t load the 3D renderer (${(e as Error).message})`);
      }
      if (!alive) return;
      const p = propsRef.current;
      const canvas = document.createElement("canvas");
      canvas.className = "block h-full w-full outline-none";
      canvas.dataset.testid = "board-3d-canvas";
      host.appendChild(canvas);
      try {
        // the geo provider's anim timelines pass through ?tune clip edits (a no-op otherwise)
        r = await mod.createBoard(canvas, withAnimTuning(p.geo, tuneStore.anim), {
          style: p.styleId,
          camera: toThree(p.camera),
          tier: p.tier === "auto" ? detectTier(probe) : p.tier,
          reducedMotion: p.reducedMotion,
        });
      } catch (e) {
        canvas.remove();
        return fail(`3D renderer failed to start (${(e as Error).message})`);
      }
      if (!alive) {
        r.dispose();
        r.canvas.remove();
        return;
      }
      const board = r;
      board.canvas.setAttribute("aria-hidden", "true");
      rRef.current = board;
      window.__carc3d = { renderer: board, project: (x, y) => mod.projectToClient(board, x, y) };

      // pointer → app callbacks (deduplicated so the HUD doesn't re-render per pixel)
      let lastCell = "";
      let lastFeature = "";
      let lastPointer = { x: 0, y: 0 };
      const onDown = (e: PointerEvent) => (lastPointer = { x: e.clientX, y: e.clientY });
      host.addEventListener("pointerdown", onDown, true);
      const onEvent = (e: RendererEvent) => {
        const cur = propsRef.current;
        if (e.type === "hover") {
          const c = e.pick?.cell ?? null;
          const ck = c ? `${c.x},${c.y}` : "";
          if (ck !== lastCell) {
            lastCell = ck;
            cur.onCellHover?.(c ? { x: c.x, y: c.y } : null);
          }
          const pk = e.pick;
          const onBoard = !!pk && pk.feature !== null && cur.view.board.some((b) => b.x === pk.cell.x && b.y === pk.cell.y);
          const node = onBoard ? { x: pk!.cell.x, y: pk!.cell.y, feature: pk!.feature! } : null;
          const fk = node ? `${node.x},${node.y},${node.feature}` : "";
          if (fk !== lastFeature) {
            lastFeature = fk;
            cur.onFeatureHover?.(node);
          }
        } else if (e.type === "animationEnd") {
          outstanding.current = Math.max(0, outstanding.current - 1);
        } else if (e.type === "click") {
          cur.onCellClick?.({ x: e.pick.cell.x, y: e.pick.cell.y }, e.pick, lastPointer);
        }
      };
      const off = board.on(onEvent);
      offEvents = () => {
        off();
        host.removeEventListener("pointerdown", onDown, true);
      };
      // dragging / panning switches the rig to free orbit: tell the HUD
      let reported = board.cameraMode;
      poll = setInterval(() => {
        if (board.cameraMode !== reported) {
          reported = board.cameraMode;
          propsRef.current.onCameraChange?.(fromThree(reported));
        }
        if (propsRef.current.debug) setStats({ ...board.stats(), gpu: probe.gpu });
      }, 400);
      setReady(true);
    })();
    return () => {
      alive = false;
      offEvents?.();
      if (poll) clearInterval(poll);
      if (r) {
        r.dispose();
        r.canvas.remove();
      }
      if (window.__carc3d?.renderer === r) window.__carc3d = null;
      rRef.current = null;
      setReady(false);
    };
  }, []);

  // ── framing: legal spots stay on screen, clear of the HUD ─────────────────
  const insetKey = props.insets ? `${props.insets.top},${props.insets.right},${props.insets.bottom},${props.insets.left}` : "";
  useEffect(() => {
    const host = hostRef.current;
    const r = rRef.current;
    if (!ready || !host || !r) return;
    const apply = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const i = propsRef.current.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
      r.setFraming({ includeHints: true, insets: { top: i.top / h, right: i.right / w, bottom: i.bottom / h, left: i.left / w } });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, [ready, insetKey]);

  // ── commands (keyboard zoom / pan / fit / reveal) ─────────────────────────
  const { commandsRef } = props;
  useEffect(() => {
    if (!commandsRef || !ready) return;
    const r = rRef.current!;
    const focus = (c: Cell) => r.rig.hint(c.x + 0.5, c.y + 0.5, 1.6, 0.5, 2.5);
    commandsRef.current = {
      zoom: (f) => r.rig.zoom(1 / f),
      pan: (dx, dy) => r.rig.pan(dx, dy),
      fit: () => {
        // re-entering a framed mode resets the user zoom; free orbit goes back to tabletop
        const m = r.cameraMode === "orbit" ? "tabletop" : r.cameraMode;
        r.setCamera(m === "top" ? "tabletop" : "top");
        r.setCamera(m);
      },
      reveal: focus,
      focus,
    };
    return () => {
      if (commandsRef.current) commandsRef.current = null;
    };
  }, [commandsRef, ready]);

  // ── prop sync ─────────────────────────────────────────────────────────────
  const { styleId, camera, tier, reducedMotion, view, batches, playerSlots, hints, ghost, pending } = props;

  // style switches apply at once; ?tune edits (a new pack object per change) coalesce per frame
  const tunedPack = useTunedPack(styleId);
  useEffect(() => {
    if (!ready) return;
    if (!tunedPack) return rRef.current!.setStyle(styleId);
    const id = requestAnimationFrame(() => rRef.current?.setStyle(tunedPack));
    return () => cancelAnimationFrame(id);
  }, [ready, styleId, tunedPack]);

  useEffect(() => {
    const r = rRef.current;
    if (ready && r && r.cameraMode !== toThree(camera)) r.setCamera(toThree(camera));
  }, [ready, camera]);

  useEffect(() => {
    if (ready) rRef.current!.setTier(tier === "auto" ? detectTier() : tier);
  }, [ready, tier]);

  useEffect(() => {
    if (ready) rRef.current!.setReducedMotion(reducedMotion);
  }, [ready, reducedMotion]);

  const slotsKey = playerSlots?.join(",") ?? "";
  useEffect(() => {
    if (ready) rRef.current!.setPlayerSlots(slotsKey ? slotsKey.split(",").map(Number) : null);
  }, [ready, slotsKey]);

  // view + animation: new batches play through the anim timeline, other changes snap
  const seen = useRef<{ seq: number; view: GameView | null }>({ seq: -1, view: null });
  /** Batches handed to the timeline whose animation hasn't ended yet. */
  const outstanding = useRef(0);
  useEffect(() => {
    const r = rRef.current;
    if (!ready || !r) return;
    const st = seen.current;
    const list = batches ?? [];
    if (!st.view) {
      r.setView(view);
      st.seq = list.length ? list[list.length - 1]!.seq : -1;
      st.view = view;
      return;
    }
    const fresh = list.filter((b) => b.seq > st.seq);
    if (fresh.length) {
      // Keep up with the game on slow devices / fast bots: when a backlog builds,
      // skip the queued animations to their end and animate only the newest batch.
      if (outstanding.current + fresh.length > 2) {
        for (const b of fresh.slice(0, -1)) r.pushEvents(b.events);
        r.finishAnimations();
        outstanding.current = 0;
        fresh.splice(0, fresh.length - 1);
      }
      fresh.forEach((b, i) => r.pushEvents(b.events, i === fresh.length - 1 ? view : undefined));
      outstanding.current += fresh.length;
      st.seq = fresh[fresh.length - 1]!.seq;
    } else if (view !== st.view) r.setView(view);
    st.view = view;
  }, [ready, view, batches]);

  useEffect(() => {
    if (ready) rRef.current!.setPlacementHints(hints ?? null);
  }, [ready, hints]);

  const pendingKey = pending ? `${pending.tile}|${pending.placement.x},${pending.placement.y},${pending.placement.rot}|${pending.options.map((o) => `${o.type}${o.feature}`).join(",")}` : "";
  useEffect(() => {
    const r = rRef.current;
    if (!ready || !r) return;
    const p = propsRef.current.pending;
    r.setPendingPlacement(p?.placement ?? null, p?.options ?? [], p?.tile);
  }, [ready, pendingKey]);

  const ghostKey = ghost ? `${ghost.x},${ghost.y},${ghost.rot}` : "";
  const hintTile = hints?.tile;
  useEffect(() => {
    const r = rRef.current;
    if (!ready || !r || pendingKey) return;
    const g = propsRef.current.ghost;
    r.setGhost(g ?? null, g ? hintTile : undefined);
  }, [ready, ghostKey, hintTile, pendingKey]);

  // scroll over a legal spot rotates the tile in hand (else the renderer zooms)
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      const p = propsRef.current;
      const r = rRef.current;
      if (!r || e.ctrlKey || !p.hints || p.pending || !p.onRotate) return;
      const pick = r.pick(e.clientX, e.clientY);
      if (!pick || !p.hints.placements.some((q) => q.x === pick.cell.x && q.y === pick.cell.y)) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - last > 140 && Math.abs(e.deltaY) > 2) {
        last = now;
        p.onRotate(e.deltaY > 0 ? 1 : -1);
      }
    };
    host.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => host.removeEventListener("wheel", onWheel, { capture: true });
  }, [ready]);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", props.className)}
      data-testid="board-3d"
      data-ready={ready ? "1" : "0"}
      data-style={styleId}
      data-hints={hints ? [...new Set(hints.placements.map((p) => `${p.x},${p.y}`))].join(";") : ""}
      role="application"
      aria-label={props.ariaLabel}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {ready && props.controls !== false ? (
        <div className="carc-hud-sheet carc-hud-toolbar absolute right-3 bottom-3" data-board-controls data-orientation="horizontal">
          {[
            { label: "Zoom in", title: "Zoom in (+)", Icon: Plus, run: (r: BoardRenderer) => r.rig.zoom(1 / 1.25) },
            { label: "Zoom out", title: "Zoom out (−)", Icon: Minus, run: (r: BoardRenderer) => r.rig.zoom(1.25) },
            { label: "Fit board", title: "Reframe the board (F)", Icon: Maximize, run: () => props.commandsRef?.current?.fit() ?? rRef.current?.setCamera("tabletop") },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              aria-label={b.label}
              title={b.title}
              onClick={() => rRef.current && b.run(rRef.current)}
              className="carc-icon-btn"
            >
              <b.Icon />
            </button>
          ))}
        </div>
      ) : null}
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="carc-board-message animate-pulse">Setting the table…</div>
        </div>
      ) : null}
      {props.debug && stats ? (
        <pre
          className="pointer-events-none absolute bottom-24 left-3 z-10 rounded-lg bg-black/70 px-2.5 py-1.5 font-mono text-[13px] leading-snug text-lime-200"
          data-testid="debug-overlay"
        >
          {`${fpsText(stats.intervalMs)} fps · frame ${stats.frameMs.toFixed(1)} ms
${stats.backend} · ${stats.style} · ${stats.camera} · tier ${stats.tier}
tiles ${stats.tiles} · figures ${stats.figures}
draws ${stats.drawCalls} · tris ${Math.round(stats.triangles)}
cache ${stats.meshCache.size} (${stats.meshCache.hits}/${stats.meshCache.misses})${stats.gpu ? `\n${stats.gpu.slice(0, 48)}` : ""}`}
        </pre>
      ) : null}
    </div>
  );
}

function fpsText(intervalMs: number): string {
  const fps = 1000 / Math.max(1, intervalMs);
  return fps < 10 ? fps.toFixed(1) : String(Math.round(fps));
}
