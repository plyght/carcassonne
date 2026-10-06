"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronDown, Lightbulb, SlidersHorizontal, Undo2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

import type { EngineEvent, FigureOption, Move } from "@carcassonne/protocol";
import {
  analyzeBoard,
  boardFromTiles,
  LocalEngineClient,
  narrateBatch,
  legalCells,
  neighbourCount,
  nextRotation,
  snapRotation,
  stepCell,
  type GameClient,
  type NodeRef,
} from "@carcassonne/game-client";
import {
  ClassicBoard,
  hudPalette,
  is3DStyle,
  PLAYER_COLOR_ORDER,
  PLAYER_COLORS,
  playerFill,
  proceduralArt,
  renderableStyle,
  type BoardCommands,
  type Cell,
  type Floater,
} from "@carcassonne/render-classic";
import type { PickResult } from "@carcassonne/render-three";
import { cn } from "@carcassonne/ui/lib/utils";

import { playTick, useAudioLevels } from "@/lib/audio";
import { useCore } from "@/lib/core";
import { fallbackToClassic, useBoardCamera } from "@/lib/board-controls";
import { updateSettings, useDebugFlag, useReducedMotion, useSettings } from "@/lib/settings";
import { useTunedPalette, useTuneMode } from "@/lib/tuning";

import { Board3D } from "../board3d/board-3d";
import { TablePanel } from "../dial/table-panel";
import { TuneMode } from "../tune/tune-mode";
import { EndSummary } from "./end-summary";
import { HowToPlay } from "../learn/how-to-play";
import { CoachMarks } from "./coach-marks";
import { playerName, projectExtent, useClientState, type Projection } from "./helpers";
import { TurnGuide, type GuideScore } from "./turn-guide";
import {
  BoardHelp,
  BoardToolbar,
  FeatureInfo,
  figureChoices,
  Panel,
  ReactionBar,
  RemainingTiles,
  ScorePanel,
  TileInHand,
  TurnClock,
  type FigureChoice,
} from "./hud-parts";
import { PassDevice } from "./pass-device";

export interface GameScreenProps {
  client: GameClient;
  title: string;
  subtitle?: ReactNode;
  /** Hot-seat: several humans share this device. */
  hotseat?: boolean;
  endActions?: ReactNode;
  exitHref?: string;
  /** First-game coach marks (local games). */
  coach?: boolean;
  /** Lesson mode: the lesson card replaces the turn guide, and the lesson sets the rules of the hand. */
  lesson?: LessonHud | null;
}

export interface LessonHud {
  /** The instruction card, shown where the turn guide sits (told whether a figure is being chosen). */
  card: ReactNode | ((ctx: { pending: boolean; canAct: boolean }) => ReactNode);
  /** Snap the preview to a legal rotation on hover (off when the lesson teaches rotating). */
  snap: boolean;
  allowSkip: boolean;
  /** Rotation of the tile in hand when the step starts. */
  startRot?: number;
  /** Changes when the lesson step changes (resets the hand). */
  stepKey: string;
  /** Tell the lesson the player tried a rotation that does not fit. */
  onMisfit?(): void;
  /** The lesson is over: nobody is to move (hide the hand and the turn). */
  idle?: boolean;
}

interface Pending {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  options: FigureOption[];
}

export function GameScreen({ client, title, subtitle, hotseat, endActions, exitHref = "/", coach, lesson }: GameScreenProps) {
  const s = useClientState(client);
  const settings = useSettings();
  const reducedMotion = useReducedMotion();
  const style = renderableStyle(settings.style);
  const palette = useTunedPalette(hudPalette(style));
  const tune = useTuneMode();
  const debug = useDebugFlag();
  const core = useCore();
  const art = core?.art ?? proceduralArt;
  const catalog = client.catalog;
  const view = s.view;

  const [rot, setRot] = useState(0);
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [featureNode, setFeatureNode] = useState<NodeRef | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [styleOpen, setStyleOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const closeRules = useCallback(() => setRulesOpen(false), []);
  const [hoverChoice, setHoverChoice] = useState<FigureChoice | null>(null);
  const [flash, setFlash] = useState<NodeRef[] | null>(null);
  const snap = lesson ? lesson.snap : true;
  const allowSkip = lesson ? lesson.allowSkip : true;
  const tableButton = useRef<HTMLButtonElement>(null);
  const closeTable = useCallback(() => setStyleOpen(false), []);
  useAudioLevels();
  const [revealedPly, setRevealedPly] = useState<number>(-1);
  const [hintMove, setHintMove] = useState<Move | null>(null);
  const [fitSignal] = useState(0);
  const commands = useRef<BoardCommands | null>(null);
  /** 3D: figure menu opened by clicking the placed tile (ambiguous feature, or skip). */
  const [figureMenu, setFigureMenu] = useState<{ x: number; y: number; choices: FigureChoice[] } | null>(null);
  const is3d = is3DStyle(style) && !!core;
  // Camera actually in use: settings, or free orbit after the player drags the 3D board.
  const { camera, choose: chooseCamera, report: setCamera } = useBoardCamera(style);
  const on3DFail = useCallback((reason: string) => {
    console.warn("[board3d]", reason);
    toast.error("3D board unavailable, switched to Classic Board", { description: reason, id: "board3d-fallback" });
    fallbackToClassic();
  }, []);

  const isLocal = client instanceof LocalEngineClient;
  const myTurn = !!view && view.status === "playing" && s.localSeats.includes(view.currentPlayer) && !s.thinking;
  const humanSeats = s.players.filter((p) => p.kind === "human").length;
  const needsPass =
    !!hotseat && settings.hotseatPrivacy && humanSeats > 1 && myTurn && revealedPly !== (view?.ply ?? -1) && (view?.ply ?? 0) > 0;
  const canAct = myTurn && !needsPass;
  const targets = useMemo(() => (canAct && !pending ? legalCells(s.legalPlacements) : []), [canAct, pending, s.legalPlacements]);

  // Reset hand state when the turn changes.
  const turnKey = `${view?.ply}:${view?.currentPlayer}:${lesson?.stepKey ?? ""}`;
  useEffect(() => {
    setPending(null);
    setHintMove(null);
    setCursor(null);
    setFigureMenu(null);
    setHoverChoice(null);
    if (lesson?.startRot !== undefined) setRot(lesson.startRot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);
  useEffect(() => {
    if (!pending) setFigureMenu(null);
  }, [pending]);

  // Frame the board inside the HUD panels (hud.css: inset 12, bar 56, column 304 / 280, gap 8).
  const [vw, setVw] = useState(1440);
  const [dialSize, setDialSize] = useState(112);
  const [guideH, setGuideH] = useState(0);
  const guideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      setVw(window.innerWidth);
      setDialSize(window.innerWidth >= 768 ? 112 : 88);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // The guide sits top-centre on wide screens and under the score strip on phones; the
  // board frames itself below it. Between those it lives in the left column.
  const guideTop = vw >= 1100 || vw < 768;
  useEffect(() => {
    const el = guideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return setGuideH(0);
    const ro = new ResizeObserver(() => setGuideH(el.offsetHeight));
    ro.observe(el);
    setGuideH(el.offsetHeight);
    return () => ro.disconnect();
  });
  const insets = useMemo(() => {
    const col = vw >= 1024 ? 304 : 280;
    const extra = guideTop && guideH ? guideH + 8 : 0;
    return vw >= 768
      ? { top: 76 + extra, right: 12 + col + 8, bottom: 68, left: 12 + col + 8 }
      : { top: 128 + extra, right: 8, bottom: 200, left: 8 };
  }, [vw, guideTop, guideH]);

  // Score floaters for the newest event batch.
  const lastBatch = s.recent.at(-1);
  useEffect(() => {
    if (!lastBatch) return;
    const fl: Floater[] = [];
    lastBatch.events.forEach((e, i) => {
      if (e.type !== "featureScored" || !e.winners.length || !e.points) return;
      const cx = e.cells.reduce((a, c) => a + c[0], 0) / e.cells.length;
      const cy = e.cells.reduce((a, c) => a + c[1], 0) / e.cells.length;
      e.winners.forEach((w, k) =>
        fl.push({
          id: `${lastBatch.seq}-${i}-${k}`,
          x: (cx + 0.5) * 100 + k * 30,
          y: (cy + 0.5) * 100,
          text: `+${e.points}`,
          color: playerFill(palette, s.players[w]?.color ?? "red"),
        }),
      );
    });
    if (!fl.length) return;
    setFloaters(fl);
    const id = setTimeout(() => setFloaters([]), 1700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBatch?.seq]);

  // Point at what just happened: a scored feature, or what another player claimed.
  useEffect(() => {
    if (!lastBatch) return;
    const a = client.analysis();
    if (!a) return;
    const placed = lastBatch.events.find((e) => e.type === "tilePlaced");
    const mover = placed && placed.type === "tilePlaced" ? placed.player : null;
    let nodes: NodeRef[] | null = null;
    const sc = lastBatch.events.find((e) => e.type === "featureScored" && e.winners.length > 0);
    if (sc && sc.type === "featureScored") {
      const want = new Set(sc.cells.map(([x, y]) => `${x},${y}`));
      const ext = a.extents.find((x) => x.kind === sc.kind && x.cells.length === want.size && x.cells.every(([x2, y2]) => want.has(`${x2},${y2}`)));
      nodes = ext?.nodes ?? null;
    } else if (mover !== null && !s.localSeats.includes(mover)) {
      const fig = lastBatch.events.find((e) => e.type === "figurePlaced");
      if (fig && fig.type === "figurePlaced") nodes = a.extentOf(fig.x, fig.y, fig.feature)?.nodes ?? null;
    }
    if (!nodes) return;
    setFlash(nodes);
    const id = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBatch?.seq]);

  const lastPlaced = useMemo(() => {
    for (let i = s.recent.length - 1; i >= 0; i--) {
      const e = [...s.recent[i]!.events].reverse().find((x): x is Extract<EngineEvent, { type: "tilePlaced" }> => x.type === "tilePlaced");
      if (e) return { x: e.x, y: e.y };
    }
    return null;
  }, [s.recent]);

  const edition = view?.ruleset.fieldEdition ?? 3;
  const narrated = useMemo(
    () => s.recent.map((b) => ({ seq: b.seq, mover: moverOf(b.events), lines: narrateBatch(b.events, s.players, catalog, edition) })),
    [s.recent, s.players, catalog, edition],
  );
  const seatColor = useCallback((p: number | null) => (p === null ? null : PLAYER_COLORS[s.players[p]?.color ?? "red"].fill), [s.players]);
  const log = useMemo(() => {
    const lines: { key: string; text: string; color: string | null; score?: boolean }[] = [];
    for (const b of narrated.slice(-8)) b.lines.forEach((l, i) => lines.push({ key: `${b.seq}-${i}`, text: l.text, color: seatColor(l.player), score: l.score }));
    return lines.slice(-6);
  }, [narrated, seatColor]);
  // Since your last move: what scored (explained) and what the others did.
  const guideScores: GuideScore[] = useMemo(() => {
    const out: GuideScore[] = [];
    for (let i = narrated.length - 1; i >= 0; i--) {
      const b = narrated[i]!;
      b.lines.forEach((l, k) => l.score && out.unshift({ key: `${b.seq}-${k}`, text: l.text, color: seatColor(l.player) }));
      if (b.mover !== null && s.localSeats.includes(b.mover)) break;
    }
    return out.slice(-3);
  }, [narrated, s.localSeats, seatColor]);
  const lastOtherMove = useMemo(() => {
    const b = [...narrated].reverse().find((x) => x.mover !== null && !s.localSeats.includes(x.mover));
    return b?.lines.find((l) => !l.score)?.text ?? null;
  }, [narrated, s.localSeats]);

  // ── tile in hand ──────────────────────────────────────────────────────────
  const active = hover ?? cursor;
  const activeIsTarget = !!active && targets.some((t) => t.x === active.x && t.y === active.y);
  const shownRot = activeIsTarget && active && snap ? (snapRotation(s.legalPlacements, active.x, active.y, rot) ?? rot) : rot;
  const fitsHere = (x: number, y: number, r: number) => s.legalPlacements.some((p) => p.x === x && p.y === y && p.rot === r);
  const ghost =
    view?.currentTile && canAct
      ? pending
        ? { tile: view.currentTile, x: pending.x, y: pending.y, rot: pending.rot, pending: true }
        : activeIsTarget && active
          ? { tile: view.currentTile, x: active.x, y: active.y, rot: shownRot, invalid: !fitsHere(active.x, active.y, shownRot) }
          : hintMove
            ? { tile: view.currentTile, x: hintMove.x, y: hintMove.y, rot: hintMove.rot }
            : null
      : null;

  const rotate = useCallback(
    (dir: 1 | -1) => {
      if (pending) return;
      playTick(dir > 0 ? 1 : 0.9);
      setRot((r) => (snap ? nextRotation(s.legalPlacements, activeIsTarget ? active : null, activeIsTarget ? shownRot : r, dir) : (((r + dir) % 4) + 4) % 4));
    },
    [pending, s.legalPlacements, active, activeIsTarget, shownRot, snap],
  );
  /** Rotations the dial marks as legal: at the hovered spot, else anywhere on the board. */
  const legalRots = useMemo(() => {
    const at = activeIsTarget && active ? s.legalPlacements.filter((p) => p.x === active.x && p.y === active.y) : s.legalPlacements;
    return [...new Set(at.map((p) => p.rot))];
  }, [s.legalPlacements, active, activeIsTarget]);

  const place = useCallback(
    async (cell: Cell) => {
      if (!canAct || pending) return;
      const want = cell === active ? shownRot : rot;
      const r = snap ? snapRotation(s.legalPlacements, cell.x, cell.y, want) : fitsHere(cell.x, cell.y, want) ? (want as 0 | 1 | 2 | 3) : null;
      if (r === null) {
        if (!snap) lesson?.onMisfit?.();
        return;
      }
      setRot(r);
      const options = await client.legalFigures({ x: cell.x, y: cell.y, rot: r });
      setPending({ x: cell.x, y: cell.y, rot: r, options });
      setCursor(cell);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canAct, pending, s.legalPlacements, active, shownRot, rot, client, snap, lesson],
  );

  const recallTarget = canAct && pending ? client.recallableAbbot() : null;
  const recallPoints = useMemo(() => {
    if (!recallTarget || !view) return 0;
    const board = boardFromTiles(view.board);
    return 1 + neighbourCount(board, recallTarget.x, recallTarget.y);
  }, [recallTarget, view]);

  const choices: FigureChoice[] = useMemo(() => {
    if (!pending || !view?.currentTile) return [];
    // What each claim would be worth, on the board with the new tile in place.
    const board = boardFromTiles([...view.board, { x: pending.x, y: pending.y, rot: pending.rot, tile: view.currentTile, figures: [] }]);
    const a = analyzeBoard(board, catalog);
    const project = (feature: number): Projection | null => {
      const ext = a.extentOf(pending.x, pending.y, feature);
      if (!ext) return null;
      const n0 = ext.nodes[0]!;
      const completed = ext.adjacentCities.filter((id) => a.extents[id]?.complete).length;
      return projectExtent(ext, neighbourCount(board, n0.x, n0.y), completed, view.ruleset.fieldEdition);
    };
    const all = figureChoices(pending.options, view.currentTile, catalog, recallTarget ? { points: recallPoints } : null, project);
    return allowSkip ? all : all.filter((c) => c.option !== null);
  }, [pending, view, catalog, recallTarget, recallPoints, allowSkip]);

  const choose = useCallback(
    (c: FigureChoice) => {
      if (!pending) return;
      let figure: Move["figure"] = null;
      if (c.option && c.option.type === "recallAbbot") {
        if (!recallTarget) return;
        figure = { type: "recallAbbot", x: recallTarget.x, y: recallTarget.y };
      } else if (c.option) figure = c.option as FigureOption;
      const move: Move = { x: pending.x, y: pending.y, rot: pending.rot, figure };
      setPending(null);
      setHover(null);
      void client.submit(move);
    },
    [pending, recallTarget, client],
  );

  const doUndo = useCallback(async () => {
    if (client instanceof LocalEngineClient && s.canUndo) {
      setPending(null);
      await client.undo();
    }
  }, [client, s.canUndo]);

  const doHint = useCallback(async () => {
    if (!(client instanceof LocalEngineClient) || !canAct) return;
    const m = await client.hint();
    if (m) {
      setHintMove(m);
      setRot(m.rot);
      setCursor({ x: m.x, y: m.y });
      commands.current?.reveal({ x: m.x, y: m.y });
    }
  }, [client, canAct]);

  // ── keyboard play ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (styleOpen) {
        if (e.key === "Escape") setStyleOpen(false);
        return;
      }
      const k = e.key;
      if (figureMenu && k === "Escape") {
        e.preventDefault();
        setFigureMenu(null);
        return;
      }
      if ((k === "z" && (e.metaKey || e.ctrlKey)) || k === "u" || k === "U") {
        e.preventDefault();
        void doUndo();
        return;
      }
      if (k === "+" || k === "=") return commands.current?.zoom(1.2);
      if (k === "-" || k === "_") return commands.current?.zoom(0.83);
      if (k === "f" || k === "F") return commands.current?.fit();
      if (k === "h" || k === "H") return void doHint();
      if (!canAct) return;
      if (pending) {
        if (k === "Escape" || k === "Backspace") {
          e.preventDefault();
          setPending(null);
          return;
        }
        if (k === "s" || k === "S" || k === "0" || k === "Enter" || k === " ") {
          e.preventDefault();
          const skip = choices.find((c) => c.option === null);
          if (skip) choose(skip);
          return;
        }
        if (k === "a" || k === "A") {
          const r = choices.find((c) => c.key === "recall");
          if (r) choose(r);
          return;
        }
        const n = Number(k);
        if (n >= 1 && n <= 9 && choices[n - 1] && choices[n - 1]!.option !== null) {
          e.preventDefault();
          choose(choices[n - 1]!);
        }
        return;
      }
      if (k === "r" || k === "R" || k === "e" || k === "E" || k === "q" || k === "Q") {
        e.preventDefault();
        rotate(k === "R" || k === "q" || k === "Q" ? -1 : 1);
        return;
      }
      const dirs: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      if (dirs[k]) {
        e.preventDefault();
        if (e.shiftKey) {
          const d = 80;
          const [dx, dy] = k === "ArrowUp" ? [0, d] : k === "ArrowDown" ? [0, -d] : k === "ArrowLeft" ? [d, 0] : [-d, 0];
          commands.current?.pan(dx, dy);
          return;
        }
        const next = stepCell(targets, cursor ?? hover, dirs[k]!);
        if (next) {
          setCursor(next);
          setHover(null);
          commands.current?.reveal(next);
        }
        return;
      }
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        // first of cursor / pointer / hint that is a legal spot, else the first legal spot
        const isTarget = (c: Cell | null): c is Cell => !!c && targets.some((t) => t.x === c.x && t.y === c.y);
        const cell = [cursor, hover, hintMove ? { x: hintMove.x, y: hintMove.y } : null].find(isTarget) ?? targets[0];
        if (isTarget(cell ?? null)) void place(cell!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAct, pending, choices, choose, rotate, targets, cursor, hover, hintMove, place, doUndo, doHint, styleOpen, figureMenu]);

  // ── 3D board input (same actions as the 2D board) ─────────────────────────
  const hints3d = useMemo(
    () => (canAct && !pending && view?.currentTile && s.legalPlacements.length ? { tile: view.currentTile, placements: s.legalPlacements } : null),
    [canAct, pending, view?.currentTile, s.legalPlacements],
  );
  const pending3d = useMemo(
    () => (pending && view?.currentTile ? { placement: { x: pending.x, y: pending.y, rot: pending.rot }, options: pending.options, tile: view.currentTile } : null),
    [pending, view?.currentTile],
  );
  const playerSlots = useMemo(() => s.players.map((p) => Math.max(0, PLAYER_COLOR_ORDER.indexOf(p.color))), [s.players]);
  const onHover3d = useCallback((c: Cell | null) => setHover(c), []);
  const onClick3d = useCallback(
    (cell: Cell, pick: PickResult, at: { x: number; y: number }) => {
      setFigureMenu(null);
      if (!canAct) return;
      if (pending) {
        if (recallTarget && cell.x === recallTarget.x && cell.y === recallTarget.y && !(cell.x === pending.x && cell.y === pending.y)) {
          const r = choices.find((c) => c.key === "recall");
          if (r) choose(r);
          return;
        }
        if (cell.x !== pending.x || cell.y !== pending.y) {
          // clicked away from the placed tile: pick another spot
          setPending(null);
          return;
        }
        const onFeature = choices.filter((c) => c.option && "feature" in c.option && c.option.feature === pick.feature);
        if (onFeature.length === 1) return choose(onFeature[0]!);
        const skip = choices.find((c) => c.option === null);
        setFigureMenu({ x: at.x, y: at.y, choices: onFeature.length ? [...onFeature, ...(skip ? [skip] : [])] : skip ? [skip] : [] });
        return;
      }
      if (!targets.some((t) => t.x === cell.x && t.y === cell.y)) return;
      void place(active && active.x === cell.x && active.y === cell.y ? active : cell);
    },
    [canAct, pending, recallTarget, choices, choose, targets, place, active],
  );

  // ── feature hover ─────────────────────────────────────────────────────────
  const extent = useMemo(() => {
    if (!featureNode || !view) return null;
    return client.analysis()?.extentOf(featureNode.x, featureNode.y, featureNode.feature) ?? null;
  }, [featureNode, view, client]);
  const projection = useMemo(() => {
    if (!extent || !view) return null;
    const a = client.analysis()!;
    const n0 = extent.nodes[0]!;
    const neighbours = neighbourCount(boardFromTiles(view.board), n0.x, n0.y);
    const completed = extent.adjacentCities.filter((id) => a.extents[id]?.complete).length;
    return projectExtent(extent, neighbours, completed, view.ruleset.fieldEdition);
  }, [extent, view, client]);

  // ── render ────────────────────────────────────────────────────────────────
  if (s.phase === "error") {
    return (
      <div className="grid h-full place-items-center p-6">
        <Panel className="carc-sheet max-w-md text-center">
          <h2 className="carc-heading">Something went wrong</h2>
          <p className="carc-sub">{s.error}</p>
          <Link href={exitHref as "/"} className="carc-btn mt-[var(--sp-4)]">
            Back to menu
          </Link>
        </Panel>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="grid h-full place-items-center" style={{ background: palette.table }}>
        <div className="carc-board-message animate-pulse">
          {s.connection === "local" ? "Shuffling tiles…" : s.connection === "polling" ? "Polling for the game…" : "Connecting…"}
        </div>
      </div>
    );
  }

  const current = view.currentPlayer;
  const currentColor = s.players[current]?.color ?? "red";
  const ended = view.status === "ended";
  const online = s.connection !== "local";
  const waitingName = !canAct && !ended ? playerName(s.players, current) : null;
  const guidePhase = ended ? "ended" : canAct ? (pending ? "claim" : "place") : "waiting";
  const shownProjection = hoverChoice?.projection ?? projection;
  const guide = lesson ? (
    typeof lesson.card === "function" ? lesson.card({ pending: !!pending, canAct }) : lesson.card
  ) : settings.showTurnGuide && !needsPass ? (
    <TurnGuide
      phase={guidePhase}
      waitingFor={waitingName}
      thinking={s.thinking}
      scores={guideScores}
      lastMove={lastOtherMove}
      allowSkip={allowSkip}
      onRules={() => setRulesOpen(true)}
      onHide={() => {
        updateSettings({ showTurnGuide: false });
        toast("Turn guide hidden", { description: "Bring it back any time in Settings.", id: "guide-hidden" });
      }}
    />
  ) : null;
  const guideSlot = guide ? (
    <div ref={guideRef} className="carc-guide-slot" data-place={guideTop ? "top" : "column"}>
      {guide}
    </div>
  ) : null;

  return (
    <div className="carc-game" data-testid="game-screen"
      data-ply={view.ply}
      data-status={view.status}
      data-current={view.currentPlayer}
      data-my-turn={canAct ? "1" : "0"}
      data-connection={s.connection}
      data-scores={view.players.map((p) => p.score).join(",")}
      data-board={view.board.map((t) => `${t.tile}@${t.x},${t.y},${t.rot}:${t.figures.map((f) => `${f.player}${f.figure[0]}${f.feature}`).join("")}`).join(";")}
      data-reactions={s.reactions.map((r) => r.emoji).join("")}
      data-style={style.id}
      data-camera={is3d ? camera : "top-down"}
      data-pending={pending ? `${pending.x},${pending.y},${pending.rot}` : ""}
      data-targets={targets.length}
    >
      {is3d ? (
        <Board3D
          geo={core!.geo}
          styleId={style.id}
          camera={camera}
          onCameraChange={setCamera}
          tier={settings.tier}
          reducedMotion={reducedMotion}
          debug={debug}
          view={view}
          batches={s.recent}
          playerSlots={playerSlots}
          hints={hints3d}
          ghost={ghost && !ghost.pending ? { x: ghost.x, y: ghost.y, rot: ghost.rot as 0 | 1 | 2 | 3 } : null}
          pending={pending3d}
          commandsRef={commands}
          onCellHover={onHover3d}
          onFeatureHover={setFeatureNode}
          onCellClick={onClick3d}
          onRotate={rotate}
          onFail={on3DFail}
          insets={insets}
          controls={false}
          ariaLabel={`${title} board (3D). Use arrow keys to choose a spot, R to rotate, Enter to place.`}
        />
      ) : (
      <ClassicBoard
        view={view}
        catalog={catalog}
        palette={palette}
        art={art}
        players={s.players}
        targets={targets}
        ghost={ghost}
        hotspots={pending?.options.map((o) => ({ ...o, label: choices.find((c) => c.option && "feature" in c.option && c.option.feature === o.feature && c.option.type === o.type)?.label }))}
        activePlayer={current}
        recall={recallTarget ? { x: recallTarget.x, y: recallTarget.y } : null}
        highlight={extent?.nodes ?? flash ?? null}
        lastPlaced={lastPlaced}
        cursor={canAct && !pending ? cursor : null}
        floaters={floaters}
        reducedMotion={reducedMotion}
        fitSignal={fitSignal}
        insets={insets}
        controls={false}
        autoFit
        commandsRef={commands}
        onCellHover={(c) => setHover(c)}
        onCellClick={(c) => void place(c)}
        onRotate={rotate}
        onHotspot={(o) => {
          const c = choices.find((x) => x.option && "feature" in x.option && x.option.feature === o.feature && x.option.type === o.type);
          if (c) choose(c);
        }}
        onRecall={() => {
          const c = choices.find((x) => x.key === "recall");
          if (c) choose(c);
        }}
        onFeatureHover={setFeatureNode}
        ariaLabel={`${title} board. Use arrow keys to choose a spot, R to rotate, Enter to place.`}
      />
      )}

      {figureMenu && figureMenu.choices.length ? (
        <div
          className="absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+12px)]"
          style={{ left: figureMenu.x, top: figureMenu.y }}
          data-testid="figure-menu"
        >
          <Panel className="carc-figure-menu" role="menu" aria-label="Figure">
            {figureMenu.choices.map((c) => (
              <button
                key={c.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setFigureMenu(null);
                  choose(c);
                }}
                className="carc-figure"
                data-skip={c.option === null || undefined}
              >
                <span className="carc-figure-label">{c.label}</span>
                <span className="carc-figure-detail">{c.detail}</span>
              </button>
            ))}
          </Panel>
        </div>
      ) : null}

      {/* top row: title + turn, actions */}
      <div className="carc-hud-top">
        <Panel className="carc-titlebar carc-hud-bar">
          <Link href={exitHref as "/"} className="carc-icon-btn" aria-label="Leave game" title="Leave game">
            <ArrowLeft />
          </Link>
          <div className="carc-titlebar-text">
            <div className="carc-titlebar-title">{title}</div>
            <div className="carc-turn" aria-live="polite" data-mine={canAct || undefined}>
              {ended || lesson?.idle ? (
                <span className="carc-turn-who">{lesson ? "Lesson complete" : "Game over"}</span>
              ) : (
                <>
                  <span className="carc-turn-dot" style={{ background: PLAYER_COLORS[currentColor].fill }} aria-hidden />
                  <span className="carc-turn-who" data-testid="turn-indicator">
                    {canAct && s.localSeats.length === 1 ? "Your turn" : `${playerName(s.players, current)}’s turn`}
                  </span>
                  <TurnClock startedAt={s.turnStartedAt} deadline={s.deadline} />
                </>
              )}
            </div>
          </div>
          {online ? (
            <span className="carc-conn" data-state={s.connection === "open" ? "open" : s.connection === "polling" ? "polling" : "closed"} title={`Connection: ${s.connection}`}>
              {s.connection === "open" ? <Wifi aria-label="Connected" /> : s.connection === "polling" ? <Wifi className="opacity-50" aria-label="Polling" /> : <WifiOff aria-label="Disconnected" />}
            </span>
          ) : null}
        </Panel>
        <div className="carc-actions">
          <Panel className="carc-actions-bar carc-hud-bar">
            <button type="button" onClick={() => setRulesOpen(true)} className="carc-btn" data-variant="ghost" title="How to play" aria-label="How to play" data-testid="how-to-play-button">
              <BookOpen /> <span className="carc-btn-label">Rules</span>
            </button>
            {isLocal ? (
              <button type="button" onClick={() => void doUndo()} disabled={!s.canUndo} className="carc-btn" data-variant="ghost" title="Undo (U)" aria-label="Undo">
                <Undo2 /> <span className="carc-btn-label">Undo</span>
              </button>
            ) : null}
            {isLocal && settings.showHints ? (
              <button type="button" onClick={() => void doHint()} disabled={!canAct} className="carc-btn" data-variant="ghost" title="Hint (H)" aria-label="Hint">
                <Lightbulb /> <span className="carc-btn-label">Hint</span>
              </button>
            ) : null}
            <button
              ref={tableButton}
              type="button"
              onClick={() => setStyleOpen((o) => !o)}
              className="carc-btn carc-table-button"
              data-variant="ghost"
              title="Table: style, camera, quality, sound"
              aria-label="Table settings"
              aria-expanded={styleOpen}
              aria-haspopup="dialog"
              data-testid="style-button"
            >
              <SlidersHorizontal /> <span className="carc-btn-label carc-table-name">{style.name}</span>
              <ChevronDown className="carc-chevron" />
            </button>
          </Panel>
          <TablePanel
            open={styleOpen}
            onClose={closeTable}
            camera={camera}
            onCamera={chooseCamera}
            is3d={is3d}
            commands={commands}
            anchorRef={tableButton}
          />
        </div>
      </div>

      {guideTop && guideSlot ? <div className="carc-hud-guide">{guideSlot}</div> : null}

      {/* left column: scores, recent events */}
      <div className="carc-hud-left">
        <ScorePanel
          view={view}
          players={s.players}
          localSeats={s.localSeats}
          reactions={s.reactions}
          hideReactions={settings.hideReactions}
          thinking={s.thinking}
          palette={palette}
          footer={subtitle}
          idle={!!lesson?.idle}
        />
        {!guideTop ? guideSlot : null}
        {log.length ? (
          <Panel className="carc-log" aria-label="What happened">
            <div className="carc-eyebrow">What happened</div>
            <ul>
              {log.map((l) => (
                <li key={l.key} data-score={l.score || undefined}>
                  <span className="carc-log-dot" style={{ background: l.color ?? "var(--text-2)" }} aria-hidden />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      {/* right column: tile in hand, draw pile */}
      <div className="carc-hud-right">
        {!ended && !lesson?.idle ? (
          <TileInHand
            tile={view.currentTile}
            rot={pending ? pending.rot : ghost ? ghost.rot : rot}
            catalog={catalog}
            art={art}
            palette={palette}
            hidden={needsPass}
            canAct={canAct}
            pending={!!pending}
            choices={choices}
            onRotate={rotate}
            legalRots={legalRots}
            onChoose={choose}
            onBack={() => setPending(null)}
            onHoverChoice={setHoverChoice}
            waitingFor={!canAct ? playerName(s.players, current) : null}
            thinking={s.thinking}
            allowSkip={allowSkip}
            color={s.players[current]?.color}
            dialSize={dialSize}
          />
        ) : null}
        {settings.showRemaining && !ended ? <RemainingTiles remaining={view.remaining} catalog={catalog} art={art} palette={palette} /> : null}
        {s.error ? (
          <Panel className="carc-hud-panel" role="alert">
            <p className="carc-notice" data-tone="danger">
              {s.error}
            </p>
          </Panel>
        ) : null}
      </div>

      {/* bottom row: help, feature info + reactions, board toolbar */}
      <div className="carc-hud-bottom">
        <div className="carc-hud-bottom-start">
          <BoardHelp is3d={is3d} />
        </div>
        <div className="carc-hud-bottom-center">
          {shownProjection ? <FeatureInfo p={shownProjection} players={s.players} edition={edition} choosing={!!hoverChoice} /> : null}
          <ReactionBar onReact={(e) => client.react(e)} />
        </div>
        <div className="carc-hud-bottom-end">
          <BoardToolbar commands={commands} fitLabel={is3d ? "Reframe the board" : "Fit board"} />
        </div>
      </div>

      {needsPass ? <PassDevice player={current} meta={s.players[current]} onReveal={() => setRevealedPly(view.ply)} /> : null}

      {coach && !lesson && !needsPass ? (
        <CoachMarks
          ctx={{
            myTurn: canAct,
            pending: !!pending,
            ply: view.ply,
            spot: () => {
              const t0 = targets[0];
              const p = t0 ? commands.current?.toScreen?.(t0) : null;
              return p ? new DOMRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size) : null;
            },
          }}
        />
      ) : null}

      <HowToPlay open={rulesOpen} onClose={closeRules} />

      {ended && summaryOpen && !lesson ? (
        <EndSummary view={view} players={s.players} onClose={() => setSummaryOpen(false)} actions={endActions} />
      ) : null}

      {tune ? <TuneMode style={style} palette={palette} /> : null}
      <span className={cn("sr-only")} aria-live="assertive">
        {canAct ? (pending ? "Claim something with a meeple, or press S to skip" : "Your turn: place your tile on a glowing spot") : ""}
      </span>
    </div>
  );
}

function moverOf(events: EngineEvent[]): number | null {
  const e = events.find((x) => x.type === "tilePlaced");
  return e && e.type === "tilePlaced" ? e.player : null;
}
