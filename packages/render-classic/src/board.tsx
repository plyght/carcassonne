"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import type { FigureOption, GameView, TileId } from "@carcassonne/protocol";
import type { NodeRef, PlayerColorId, TileCatalog } from "@carcassonne/game-client";

import { installedFigureArt, installedTileArt } from "./defaults";
import { FigureToken, proceduralFigures, type FigureArtSource } from "./figures";
import { PLAYER_COLORS, playerFill, type BoardPalette } from "./palette";
import { proceduralArt } from "./procedural-art";
import { PaletteDefs, TileSvg } from "./tile";
import { rotatePoint, TILE, type TileArtSource } from "./tile-art";

export interface Cell {
  x: number;
  y: number;
}

export interface GhostTile {
  tile: TileId;
  x: number;
  y: number;
  rot: number;
  /** Tile is placed tentatively and waits for the figure choice. */
  pending?: boolean;
}

export interface Floater {
  id: string | number;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface ClassicBoardProps {
  view: Pick<GameView, "board"> | null;
  catalog: TileCatalog;
  palette: BoardPalette;
  players: { color: PlayerColorId; name?: string }[];
  art?: TileArtSource;
  /** Meeple/abbot outlines (core-geo's `geo_figure` later). */
  figures?: FigureArtSource;
  /** Legal cells for the tile in hand. */
  targets?: Cell[];
  ghost?: GhostTile | null;
  /** Figure hotspots on the pending ghost tile. */
  hotspots?: (FigureOption & { label?: string })[];
  /** Player currently choosing (colours the hotspots). */
  activePlayer?: number;
  /** Abbot that can be recalled this turn. */
  recall?: Cell | null;
  highlight?: NodeRef[] | null;
  lastPlaced?: Cell | null;
  cursor?: Cell | null;
  floaters?: Floater[];
  reducedMotion?: boolean;
  /** Change to re-fit the camera to the board. */
  fitSignal?: number;
  interactive?: boolean;
  className?: string;
  ariaLabel?: string;
  onCellHover?(cell: Cell | null): void;
  onCellClick?(cell: Cell): void;
  /** Scroll over a legal cell rotates the tile in hand. */
  onRotate?(dir: 1 | -1): void;
  onHotspot?(opt: FigureOption): void;
  onRecall?(): void;
  onFeatureHover?(node: NodeRef | null): void;
  /** Screen-space margins covered by HUD panels; fitting frames the board inside them. */
  insets?: { top: number; right: number; bottom: number; left: number };
  /** Re-frame automatically when the board grows out of view. */
  autoFit?: boolean;
  /** Imperative camera commands (keyboard shortcuts in the host app). */
  commandsRef?: { current: BoardCommands | null };
}

export interface BoardCommands {
  zoom(factor: number): void;
  pan(dx: number, dy: number): void;
  fit(): void;
  /** Make sure a cell is visible. */
  reveal(cell: Cell): void;
}

interface Camera {
  tx: number;
  ty: number;
  s: number;
}

const MIN_S = 0.12;
const MAX_S = 3;

function boundsOf(cells: Cell[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cells) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
  }
  if (!Number.isFinite(x0)) return { x0: -1, y0: -1, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

const BOARD_CSS = `
.cc-board { touch-action: none; user-select: none; -webkit-user-select: none; }
.cc-board.cc-panning { cursor: grabbing; }
.cc-target { transition: fill 120ms ease; }
.cc-anim .cc-pop { animation: cc-pop 260ms cubic-bezier(.2,.9,.3,1.25); transform-box: fill-box; transform-origin: center; }
.cc-anim .cc-pulse { animation: cc-pulse 1.4s ease-in-out infinite; }
.cc-anim .cc-float { animation: cc-float 1.6s ease-out forwards; }
.cc-anim .cc-ghost { transition: opacity 120ms ease; }
.cc-anim .cc-hotspot { animation: cc-breathe 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes cc-pop { from { transform: scale(.82); opacity: .4 } to { transform: scale(1); opacity: 1 } }
@keyframes cc-pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes cc-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.12) } }
@keyframes cc-float { from { transform: translateY(0); opacity: 1 } to { transform: translateY(-46px); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .cc-anim .cc-pop, .cc-anim .cc-pulse, .cc-anim .cc-float, .cc-anim .cc-hotspot { animation: none } }
`;

export function ClassicBoard(props: ClassicBoardProps) {
  const {
    view,
    catalog,
    palette,
    players,
    art = installedTileArt() ?? proceduralArt,
    figures = installedFigureArt() ?? proceduralFigures,
    targets = [],
    ghost,
    hotspots,
    activePlayer = 0,
    recall,
    highlight,
    lastPlaced,
    cursor,
    floaters,
    reducedMotion,
    fitSignal = 0,
    interactive = true,
    className,
    ariaLabel = "Game board",
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>({ tx: 400, ty: 300, s: 0.6 });
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  const [panning, setPanning] = useState(false);
  const camRef = useRef(cam);
  camRef.current = cam;
  const propsRef = useRef(props);
  propsRef.current = props;

  const tiles = view?.board ?? [];
  const targetKeys = useMemo(() => new Set(targets.map((t) => `${t.x},${t.y}`)), [targets]);

  // ── sizing + fit ────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const insets = props.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const area = {
    x: insets.left,
    y: insets.top,
    w: Math.max(120, size.w - insets.left - insets.right),
    h: Math.max(120, size.h - insets.top - insets.bottom),
  };

  const fit = useCallback(() => {
    const cells: Cell[] = [...(view?.board ?? []).map((t) => ({ x: t.x, y: t.y })), ...targets];
    const b = boundsOf(cells);
    const wUnits = (b.x1 - b.x0 + 1 + 1) * TILE;
    const hUnits = (b.y1 - b.y0 + 1 + 1) * TILE;
    const s = Math.max(MIN_S, Math.min(1.1, Math.min(area.w / wUnits, area.h / hUnits)));
    const cx = ((b.x0 + b.x1 + 1) / 2) * TILE;
    const cy = ((b.y0 + b.y1 + 1) / 2) * TILE;
    setCam({ s, tx: area.x + area.w / 2 - cx * s, ty: area.y + area.h / 2 - cy * s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.x, area.y, area.w, area.h, view, targets]);

  const fittedFor = useRef<string>("");
  useEffect(() => {
    const key = `${fitSignal}:${size.w}x${size.h}`;
    if (fittedFor.current === key) return;
    if (!view) return;
    fittedFor.current = key;
    fit();
  }, [fitSignal, size.w, size.h, view, fit]);

  // Auto-fit: when the board (plus legal spots) leaves the visible area, re-frame it.
  const tileCount = view?.board.length ?? 0;
  useEffect(() => {
    if (!props.autoFit || !view) return;
    const cells: Cell[] = [...view.board.map((t) => ({ x: t.x, y: t.y })), ...targets];
    const b = boundsOf(cells);
    const c = camRef.current;
    const left = b.x0 * TILE * c.s + c.tx;
    const right = (b.x1 + 1) * TILE * c.s + c.tx;
    const top = b.y0 * TILE * c.s + c.ty;
    const bottom = (b.y1 + 1) * TILE * c.s + c.ty;
    if (left < area.x || top < area.y || right > area.x + area.w || bottom > area.y + area.h) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileCount, targets.length, props.autoFit]);

  // ── coordinates ─────────────────────────────────────────────────────────
  const toBoard = useCallback((clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { bx: (clientX - r.left - c.tx) / c.s, by: (clientY - r.top - c.ty) / c.s };
  }, []);
  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell => {
      const { bx, by } = toBoard(clientX, clientY);
      return { x: Math.floor(bx / TILE), y: Math.floor(by / TILE) };
    },
    [toBoard],
  );

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    setCam((c) => {
      const s = Math.max(MIN_S, Math.min(MAX_S, c.s * factor));
      const px = clientX - r.left;
      const py = clientY - r.top;
      return { s, tx: px - ((px - c.tx) * s) / c.s, ty: py - ((py - c.ty) * s) / c.s };
    });
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const r = svgRef.current?.getBoundingClientRect();
      zoomAt((r?.left ?? 0) + size.w / 2, (r?.top ?? 0) + size.h / 2, factor);
    },
    [zoomAt, size.w, size.h],
  );

  useEffect(() => {
    if (!props.commandsRef) return;
    props.commandsRef.current = {
      zoom: zoomCenter,
      pan: (dx, dy) => setCam((c) => ({ ...c, tx: c.tx + dx, ty: c.ty + dy })),
      fit,
      reveal: (cell) =>
        setCam((c) => {
          const px = (cell.x + 0.5) * TILE * c.s + c.tx;
          const py = (cell.y + 0.5) * TILE * c.s + c.ty;
          const m = TILE * c.s;
          let { tx, ty } = c;
          if (px < m) tx += m - px;
          if (px > size.w - m) tx -= px - (size.w - m);
          if (py < m) ty += m - py;
          if (py > size.h - m) ty -= py - (size.h - m);
          return { ...c, tx, ty };
        }),
    };
  });

  // ── wheel: zoom, or rotate the tile in hand over a legal cell ───────────
  const lastRotate = useRef(0);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.interactive === false) return;
      e.preventDefault();
      const p = propsRef.current;
      const cell = cellAt(e.clientX, e.clientY);
      const overTarget = (p.targets ?? []).some((t) => t.x === cell.x && t.y === cell.y);
      if (!e.ctrlKey && overTarget && p.onRotate && !p.ghost?.pending) {
        const now = performance.now();
        if (now - lastRotate.current > 140 && Math.abs(e.deltaY) > 2) {
          lastRotate.current = now;
          p.onRotate(e.deltaY > 0 ? 1 : -1);
        }
        return;
      }
      const isPinch = e.ctrlKey;
      const isTrackpadPan = !isPinch && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY));
      if (isTrackpadPan) {
        setCam((c) => ({ ...c, tx: c.tx - e.deltaX, ty: c.ty - e.deltaY }));
        return;
      }
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX, e.clientY, Math.exp(-delta * (isPinch ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cellAt, zoomAt]);

  // ── pointers: pan (1), pinch (2), click ─────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ startX: number; startY: number; moved: boolean; pinch?: { d: number; mx: number; my: number } } | null>(null);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
    if (pointers.current.size === 2 && drag.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      drag.current.moved = true;
      drag.current.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (prev && drag.current) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size >= 2 && drag.current.pinch) {
        const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const pin = drag.current.pinch;
        setCam((c) => ({ ...c, tx: c.tx + mx - pin.mx, ty: c.ty + my - pin.my }));
        if (pin.d > 0) zoomAt(mx, my, d / pin.d);
        drag.current.pinch = { d, mx, my };
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!drag.current.moved && Math.hypot(e.clientX - drag.current.startX, e.clientY - drag.current.startY) > 5) {
        drag.current.moved = true;
        setPanning(true);
        try {
          svgRef.current?.setPointerCapture(e.pointerId);
        } catch {}
      }
      if (drag.current.moved) setCam((c) => ({ ...c, tx: c.tx + dx, ty: c.ty + dy }));
      return;
    }
    if (!interactive) return;
    const cell = cellAt(e.clientX, e.clientY);
    const target = targetKeys.has(`${cell.x},${cell.y}`) ? cell : null;
    if (target?.x !== hoverCell?.x || target?.y !== hoverCell?.y) {
      setHoverCell(target);
      props.onCellHover?.(target);
    }
    if (props.onFeatureHover) {
      const el = (e.target as Element).closest?.("[data-node]");
      const raw = el?.getAttribute("data-node");
      if (raw) {
        const [x, y, f] = raw.split(",").map(Number) as [number, number, number];
        props.onFeatureHover({ x, y, feature: f });
      } else props.onFeatureHover(null);
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size === 0) {
      drag.current = null;
      setPanning(false);
    }
    if (!d || d.moved || !interactive) return;
    if ((e.target as Element).closest?.("[data-hotspot],[data-recall]")) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (targetKeys.has(`${cell.x},${cell.y}`)) props.onCellClick?.(cell);
  };

  const onPointerLeave = () => {
    if (!drag.current?.moved) {
      pointers.current.clear();
      drag.current = null;
    }
    if (hoverCell) {
      setHoverCell(null);
      props.onCellHover?.(null);
    }
    props.onFeatureHover?.(null);
  };

  // ── drawing helpers ─────────────────────────────────────────────────────
  const appearance = (player: number) => {
    const color = players[player]?.color ?? "red";
    const a = PLAYER_COLORS[color];
    return { fill: playerFill(palette, color), ink: a.ink, marker: a.marker };
  };

  const anchorOf = (tile: TileId, rot: number, feature: number, x: number, y: number) => {
    const def = catalog.get(tile);
    if (!def) return [x * TILE + 50, y * TILE + 50] as const;
    const f = art.get(def).features[feature];
    const [ax, ay] = rotatePoint(f?.anchor ?? [50, 50], rot);
    return [x * TILE + ax, y * TILE + ay] as const;
  };

  const highlightPaths = useMemo(() => {
    if (!highlight?.length) return [];
    const byCell = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
    return highlight.flatMap((n) => {
      const t = byCell.get(`${n.x},${n.y}`);
      const def = t ? catalog.get(t.tile) : undefined;
      if (!t || !def) return [];
      const f = art.get(def).features[n.feature];
      if (!f) return [];
      return [{ key: `${n.x},${n.y},${n.feature}`, t, f }];
    });
  }, [highlight, tiles, catalog, art]);

  const anim = !reducedMotion;
  const ghostDef = ghost ? catalog.get(ghost.tile) : undefined;
  const W = 400 * TILE;

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: palette.table }}
    >
      <svg
        ref={svgRef}
        className={`cc-board ${anim ? "cc-anim" : ""} ${panning ? "cc-panning" : ""}`}
        width="100%"
        height="100%"
        role="application"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => {
          e.preventDefault();
          if (props.onRotate && !ghost?.pending) props.onRotate(1);
        }}
        style={{ display: "block", position: "absolute", inset: 0, cursor: panning ? "grabbing" : hoverCell ? "pointer" : "grab" }}
      >
        <style>{BOARD_CSS}</style>
        <PaletteDefs palette={palette} />
        <g transform={`translate(${cam.tx} ${cam.ty}) scale(${cam.s})`}>
          {palette.grid ? (
            <g pointerEvents="none">
              <defs>
                <pattern id={`cc-grid-${palette.id}`} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
                  <path d={`M0 0H${TILE}M0 0V${TILE}`} stroke={palette.grid.major} strokeWidth={1.2} fill="none" />
                  <path
                    d={`M0 25H${TILE}M0 50H${TILE}M0 75H${TILE}M25 0V${TILE}M50 0V${TILE}M75 0V${TILE}`}
                    stroke={palette.grid.minor}
                    strokeWidth={0.8}
                    fill="none"
                  />
                </pattern>
              </defs>
              <rect x={-W} y={-W} width={2 * W} height={2 * W} fill={`url(#cc-grid-${palette.id})`} />
            </g>
          ) : null}

          {/* soft shadow under tiles */}
          {palette.grid ? null : (
            <g pointerEvents="none" opacity={0.28}>
              {tiles.map((t) => (
                <rect key={`s${t.x},${t.y}`} x={t.x * TILE + 3} y={t.y * TILE + 4} width={TILE} height={TILE} fill="#1c120a" />
              ))}
            </g>
          )}

          {tiles.map((t) => {
            const def = catalog.get(t.tile);
            if (!def) return null;
            const isLast = lastPlaced && lastPlaced.x === t.x && lastPlaced.y === t.y;
            return (
              <TileSvg
                key={`${t.x},${t.y}`}
                def={def}
                art={art}
                palette={palette}
                rot={t.rot}
                x={t.x}
                y={t.y}
                hitTest={interactive}
                className={isLast ? "cc-pop" : undefined}
              />
            );
          })}

          {lastPlaced ? (
            <rect
              x={lastPlaced.x * TILE + 1}
              y={lastPlaced.y * TILE + 1}
              width={TILE - 2}
              height={TILE - 2}
              fill="none"
              stroke={palette.highlight.stroke}
              strokeWidth={2}
              strokeDasharray="6 4"
              opacity={0.75}
              pointerEvents="none"
            />
          ) : null}

          {/* feature extent highlight */}
          {highlightPaths.length ? (
            <g pointerEvents="none">
              {highlightPaths.map(({ key, t, f }) => (
                <g key={key} transform={`translate(${t.x * TILE} ${t.y * TILE}) rotate(${t.rot * 90} 50 50)`}>
                  {f.area ? (
                    <path
                      d={f.area}
                      fill={palette.highlight.fill}
                      stroke={f.kind === "field" ? "none" : palette.highlight.stroke}
                      strokeWidth={2.5}
                    />
                  ) : null}
                  {f.line ? (
                    <path d={f.line} stroke={palette.highlight.stroke} strokeWidth={9} strokeOpacity={0.85} fill="none" />
                  ) : null}
                </g>
              ))}
            </g>
          ) : null}

          {/* legal targets */}
          {targets.map((c) => {
            const hovered = hoverCell && hoverCell.x === c.x && hoverCell.y === c.y;
            return (
              <rect
                key={`t${c.x},${c.y}`}
                className="cc-target"
                x={c.x * TILE + 5}
                y={c.y * TILE + 5}
                width={TILE - 10}
                height={TILE - 10}
                rx={6}
                fill={hovered ? palette.target.hover : palette.target.fill}
                stroke={palette.target.stroke}
                strokeWidth={2}
                strokeDasharray="8 6"
                pointerEvents="none"
              />
            );
          })}

          {/* figures */}
          {tiles.flatMap((t) =>
            t.figures.map((fig, i) => {
              const def = catalog.get(t.tile);
              const kind = def?.features[fig.feature]?.kind;
              const [fx, fy] = anchorOf(t.tile, t.rot, fig.feature, t.x, t.y);
              const a = appearance(fig.player);
              return (
                <FigureToken
                  key={`m${t.x},${t.y},${fig.feature},${i}`}
                  x={fx}
                  y={fy - 4}
                  size={34}
                  kind={fig.figure}
                  lying={kind === "field"}
                  fill={a.fill}
                  ink={a.ink}
                  marker={a.marker}
                  outline={palette.figureOutline}
                  figures={figures}
                  title={`${players[fig.player]?.name ?? `Player ${fig.player + 1}`}: ${fig.figure} on ${kind ?? "feature"}`}
                />
              );
            }),
          )}

          {/* recallable abbot */}
          {recall ? (
            <g
              data-recall
              style={{ cursor: "pointer" }}
              onPointerUp={(e) => {
                e.stopPropagation();
                props.onRecall?.();
              }}
            >
              <circle
                className="cc-pulse"
                cx={recall.x * TILE + 50}
                cy={recall.y * TILE + 50}
                r={30}
                fill="transparent"
                stroke={palette.highlight.stroke}
                strokeWidth={3}
                strokeDasharray="5 4"
              />
            </g>
          ) : null}

          {/* tile in hand */}
          {ghost && ghostDef ? (
            <g pointerEvents="none" className="cc-ghost">
              <TileSvg
                def={ghostDef}
                art={art}
                palette={palette}
                rot={ghost.rot}
                x={ghost.x}
                y={ghost.y}
                opacity={ghost.pending ? 1 : 0.82}
              />
              <rect
                className={ghost.pending ? "cc-pulse" : undefined}
                x={ghost.x * TILE}
                y={ghost.y * TILE}
                width={TILE}
                height={TILE}
                fill="none"
                stroke={palette.highlight.stroke}
                strokeWidth={3}
              />
            </g>
          ) : null}

          {/* figure hotspots */}
          {ghost?.pending && ghostDef && hotspots?.length
            ? hotspots.map((h, i) => {
                const [hx, hy] = anchorOf(ghost.tile, ghost.rot, h.feature, ghost.x, ghost.y);
                const a = appearance(activePlayer);
                const offset = hotspots.findIndex((o) => o.feature === h.feature) !== i ? 14 : 0;
                return (
                  <g
                    key={`h${i}`}
                    data-hotspot
                    style={{ cursor: "pointer" }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      props.onHotspot?.({ type: h.type, feature: h.feature });
                    }}
                  >
                    <title>{h.label ?? `${h.type} on feature ${h.feature}`}</title>
                    {/* generous hit area */}
                    <circle cx={hx + offset} cy={hy - 4} r={18} fill="transparent" pointerEvents="all" />
                    <g className="cc-hotspot">
                      <FigureToken
                        x={hx + offset}
                        y={hy - 4}
                        size={34}
                        kind={h.type}
                        lying={catalog.get(ghost.tile)?.features[h.feature]?.kind === "field"}
                        fill={a.fill}
                        ink={a.ink}
                        marker={a.marker}
                        outline={palette.figureOutline}
                        figures={figures}
                        ghost
                      />
                    </g>
                  </g>
                );
              })
            : null}

          {/* keyboard cursor */}
          {cursor ? (
            <rect
              x={cursor.x * TILE - 3}
              y={cursor.y * TILE - 3}
              width={TILE + 6}
              height={TILE + 6}
              rx={8}
              fill="none"
              stroke={palette.ink}
              strokeWidth={2.5}
              strokeDasharray="3 4"
              pointerEvents="none"
            />
          ) : null}

          {/* score floaters */}
          {floaters?.map((f) => (
            <g key={f.id} className="cc-float" pointerEvents="none">
              <text
                x={f.x}
                y={f.y}
                textAnchor="middle"
                fontSize={28}
                fontWeight={800}
                fill={f.color}
                stroke={palette.figureOutline}
                strokeWidth={1.2}
                paintOrder="stroke"
              >
                {f.text}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {interactive ? <BoardControls
        onZoomIn={() => zoomCenter(1.25)}
        onZoomOut={() => zoomCenter(0.8)}
        onFit={fit}
        palette={palette}
      /> : null}
    </div>
  );
}

function BoardControls({
  onZoomIn,
  onZoomOut,
  onFit,
  palette,
}: {
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  palette: BoardPalette;
}) {
  const btn: React.CSSProperties = {
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    borderRadius: 10,
    border: `1px solid ${palette.grid ? "rgba(159,211,255,0.4)" : "rgba(43,33,23,0.25)"}`,
    background: palette.grid ? "rgba(11,29,54,0.85)" : "rgba(250,243,228,0.9)",
    color: palette.grid ? "#e8f3ff" : "#2b2117",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
  };
  return (
    <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 6 }} data-board-controls>
      <button type="button" style={btn} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in (+)">
        +
      </button>
      <button type="button" style={btn} onClick={onZoomOut} aria-label="Zoom out" title="Zoom out (−)">
        −
      </button>
      <button type="button" style={{ ...btn, fontSize: 13 }} onClick={onFit} aria-label="Fit board" title="Fit board (F)">
        ⤢
      </button>
    </div>
  );
}
