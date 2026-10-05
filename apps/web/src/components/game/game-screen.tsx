"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import Link from "next/link";
import { ArrowLeft, Lightbulb, Palette, Undo2, Wifi, WifiOff, X } from "lucide-react";

import type { EngineEvent, FigureOption, Move } from "@carcassonne/protocol";
import {
  boardFromTiles,
  LocalEngineClient,
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
  PLAYER_COLORS,
  playerFill,
  proceduralArt,
  renderableStyle,
  type BoardCommands,
  type Cell,
  type Floater,
} from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { useReducedMotion, useSettings } from "@/lib/settings";

import { StyleCarousel } from "../style/style-settings";
import { EndSummary } from "./end-summary";
import { describeEvent, playerName, projectExtent, useClientState } from "./helpers";
import {
  FeatureInfo,
  figureChoices,
  Kbd,
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
}

interface Pending {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  options: FigureOption[];
}

export function GameScreen({ client, title, subtitle, hotseat, endActions, exitHref = "/" }: GameScreenProps) {
  const s = useClientState(client);
  const settings = useSettings();
  const reducedMotion = useReducedMotion();
  const style = renderableStyle(settings.style);
  const palette = style.palette!;
  const art = proceduralArt;
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
  const [revealedPly, setRevealedPly] = useState<number>(-1);
  const [hintMove, setHintMove] = useState<Move | null>(null);
  const [fitSignal] = useState(0);
  const commands = useRef<BoardCommands | null>(null);

  const isLocal = client instanceof LocalEngineClient;
  const myTurn = !!view && view.status === "playing" && s.localSeats.includes(view.currentPlayer) && !s.thinking;
  const humanSeats = s.players.filter((p) => p.kind === "human").length;
  const needsPass =
    !!hotseat && settings.hotseatPrivacy && humanSeats > 1 && myTurn && revealedPly !== (view?.ply ?? -1) && (view?.ply ?? 0) > 0;
  const canAct = myTurn && !needsPass;
  const targets = useMemo(() => (canAct && !pending ? legalCells(s.legalPlacements) : []), [canAct, pending, s.legalPlacements]);

  // Reset hand state when the turn changes.
  const turnKey = `${view?.ply}:${view?.currentPlayer}`;
  useEffect(() => {
    setPending(null);
    setHintMove(null);
    setCursor(null);
  }, [turnKey]);

  // Frame the board inside the HUD panels.
  const [insets, setInsets] = useState({ top: 72, right: 0, bottom: 72, left: 0 });
  useEffect(() => {
    const update = () => {
      const wide = window.innerWidth >= 900;
      setInsets(wide ? { top: 76, right: 320, bottom: 76, left: 320 } : { top: 130, right: 8, bottom: 250, left: 8 });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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

  const lastPlaced = useMemo(() => {
    for (let i = s.recent.length - 1; i >= 0; i--) {
      const e = [...s.recent[i]!.events].reverse().find((x): x is Extract<EngineEvent, { type: "tilePlaced" }> => x.type === "tilePlaced");
      if (e) return { x: e.x, y: e.y };
    }
    return null;
  }, [s.recent]);

  const log = useMemo(() => {
    const lines: { key: string; text: string }[] = [];
    for (const b of s.recent.slice(-8))
      b.events.forEach((e, i) => {
        const t = describeEvent(e, s.players);
        if (t) lines.push({ key: `${b.seq}-${i}`, text: t });
      });
    return lines.slice(-5);
  }, [s.recent, s.players]);

  // ── tile in hand ──────────────────────────────────────────────────────────
  const active = hover ?? cursor;
  const activeIsTarget = !!active && targets.some((t) => t.x === active.x && t.y === active.y);
  const shownRot = activeIsTarget && active ? (snapRotation(s.legalPlacements, active.x, active.y, rot) ?? rot) : rot;
  const ghost =
    view?.currentTile && canAct
      ? pending
        ? { tile: view.currentTile, x: pending.x, y: pending.y, rot: pending.rot, pending: true }
        : activeIsTarget && active
          ? { tile: view.currentTile, x: active.x, y: active.y, rot: shownRot }
          : hintMove
            ? { tile: view.currentTile, x: hintMove.x, y: hintMove.y, rot: hintMove.rot }
            : null
      : null;

  const rotate = useCallback(
    (dir: 1 | -1) => {
      if (pending) return;
      setRot((r) => nextRotation(s.legalPlacements, activeIsTarget ? active : null, activeIsTarget ? shownRot : r, dir));
    },
    [pending, s.legalPlacements, active, activeIsTarget, shownRot],
  );

  const place = useCallback(
    async (cell: Cell) => {
      if (!canAct || pending) return;
      const r = snapRotation(s.legalPlacements, cell.x, cell.y, cell === active ? shownRot : rot);
      if (r === null) return;
      setRot(r);
      const options = await client.legalFigures({ x: cell.x, y: cell.y, rot: r });
      setPending({ x: cell.x, y: cell.y, rot: r, options });
      setCursor(cell);
    },
    [canAct, pending, s.legalPlacements, active, shownRot, rot, client],
  );

  const recallTarget = canAct && pending ? client.recallableAbbot() : null;
  const recallPoints = useMemo(() => {
    if (!recallTarget || !view) return 0;
    const board = boardFromTiles(view.board);
    return 1 + neighbourCount(board, recallTarget.x, recallTarget.y);
  }, [recallTarget, view]);

  const choices: FigureChoice[] = useMemo(
    () =>
      pending && view?.currentTile
        ? figureChoices(pending.options, view.currentTile, catalog, recallTarget ? { points: recallPoints } : null)
        : [],
    [pending, view?.currentTile, catalog, recallTarget, recallPoints],
  );

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
        const cell = cursor ?? hover ?? (hintMove ? { x: hintMove.x, y: hintMove.y } : null) ?? targets[0];
        if (cell && targets.some((t) => t.x === cell.x && t.y === cell.y)) void place(cell);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAct, pending, choices, choose, rotate, targets, cursor, hover, hintMove, place, doUndo, doHint, styleOpen]);

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
        <Panel className="max-w-md p-6 text-center">
          <h2 className="font-display text-2xl">Something went wrong</h2>
          <p className="mt-2 text-sm text-muted-foreground">{s.error}</p>
          <Link href={exitHref as "/"} className="mt-4 inline-block text-sm text-primary underline">
            Back to menu
          </Link>
        </Panel>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="grid h-full place-items-center" style={{ background: palette.table }}>
        <div className="animate-pulse font-display text-2xl text-white/90">
          {s.connection === "local" ? "Shuffling tiles…" : s.connection === "polling" ? "Polling for the game…" : "Connecting…"}
        </div>
      </div>
    );
  }

  const current = view.currentPlayer;
  const currentColor = s.players[current]?.color ?? "red";
  const ended = view.status === "ended";
  const online = !isLocal;

  return (
    <div className="relative h-full min-h-0 overflow-hidden" data-testid="game-screen" data-ply={view.ply} data-status={view.status}>
      <ClassicBoard
        view={view}
        catalog={catalog}
        palette={palette}
        art={art}
        players={s.players}
        targets={targets}
        ghost={ghost}
        hotspots={pending?.options}
        activePlayer={current}
        recall={recallTarget ? { x: recallTarget.x, y: recallTarget.y } : null}
        highlight={extent?.nodes ?? null}
        lastPlaced={lastPlaced}
        cursor={canAct && !pending ? cursor : null}
        floaters={floaters}
        reducedMotion={reducedMotion}
        fitSignal={fitSignal}
        insets={insets}
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

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <Panel className="flex min-w-0 items-center gap-3 px-3 py-2">
          <Link href={exitHref as "/"} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="Leave game">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="truncate font-display text-base leading-tight">{title}</div>
            {subtitle ? <div className="hidden truncate text-[11px] sm:block text-muted-foreground">{subtitle}</div> : null}
          </div>
          <div className="mx-1 h-8 w-px bg-border" />
          <div className="flex items-center gap-2" aria-live="polite">
            {ended ? (
              <span className="text-sm font-semibold">Game over</span>
            ) : (
              <>
                <span className="size-3 rounded-full ring-2 ring-white/60" style={{ background: PLAYER_COLORS[currentColor].fill }} />
                <span className="text-sm font-semibold whitespace-nowrap" data-testid="turn-indicator">
                  {canAct && s.localSeats.length === 1 ? "Your turn" : `${playerName(s.players, current)}’s turn`}
                </span>
                <span className="hidden sm:inline"><TurnClock startedAt={s.turnStartedAt} deadline={s.deadline} /></span>
              </>
            )}
          </div>
          {online ? (
            <span className="ml-1 text-muted-foreground" title={`Connection: ${s.connection}`}>
              {s.connection === "open" ? <Wifi className="size-4" /> : <WifiOff className="size-4 text-destructive" />}
            </span>
          ) : null}
        </Panel>
        <Panel className="flex shrink-0 items-center gap-1 p-1.5">
          {isLocal ? (
            <button
              type="button"
              onClick={() => void doUndo()}
              disabled={!s.canUndo}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
              title="Undo (U)"
            >
              <Undo2 className="size-4" /> <span className="hidden sm:inline">Undo</span>
            </button>
          ) : null}
          {isLocal && settings.showHints ? (
            <button
              type="button"
              onClick={() => void doHint()}
              disabled={!canAct}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
              title="Hint (H)"
            >
              <Lightbulb className="size-4" /> <span className="hidden sm:inline">Hint</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setStyleOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
            title="Board style"
            data-testid="style-button"
          >
            <Palette className="size-4" /> <span className="hidden sm:inline">{style.name}</span>
          </button>
        </Panel>
      </div>

      {/* left: scores */}
      <div className="pointer-events-none absolute top-[74px] right-3 left-3 flex md:right-auto md:w-[300px] flex-col gap-2">
        <ScorePanel
          view={view}
          players={s.players}
          localSeats={s.localSeats}
          reactions={s.reactions}
          hideReactions={settings.hideReactions}
          thinking={s.thinking}
          palette={palette}
        />
        {log.length ? (
          <Panel className="hidden px-3 py-2 md:block" aria-label="Recent events">
            <ul className="space-y-0.5 text-[12px] text-muted-foreground">
              {log.map((l) => (
                <li key={l.key}>{l.text}</li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      {/* right: tile in hand + remaining */}
      <div className="pointer-events-none absolute right-16 bottom-[64px] left-3 flex flex-col gap-2 md:top-[74px] md:right-3 md:bottom-auto md:left-auto md:w-[300px]">
        {!ended ? (
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
            onChoose={choose}
            onBack={() => setPending(null)}
            waitingFor={!canAct ? playerName(s.players, current) : null}
          />
        ) : null}
        {settings.showRemaining && !ended ? (
          <div className="hidden md:block">
            <RemainingTiles remaining={view.remaining} catalog={catalog} art={art} palette={palette} />
          </div>
        ) : null}
        {s.error ? (
          <Panel className="border-destructive/40 px-3 py-2 text-sm text-destructive" role="alert">
            {s.error}
          </Panel>
        ) : null}
      </div>

      {/* bottom: feature info + reactions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3">
        {projection ? <FeatureInfo p={projection} players={s.players} /> : null}
        <ReactionBar onReact={(e) => client.react(e)} />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 hidden text-[11px] text-white/80 drop-shadow lg:block">
        <Kbd>+</Kbd> <Kbd>−</Kbd> zoom · <Kbd>F</Kbd> fit · <Kbd>⇧</Kbd>+<Kbd>←</Kbd> pan · drag to pan
      </div>

      {needsPass ? <PassDevice player={current} meta={s.players[current]} onReveal={() => setRevealedPly(view.ply)} /> : null}

      {ended && summaryOpen ? (
        <EndSummary view={view} players={s.players} onClose={() => setSummaryOpen(false)} actions={endActions} />
      ) : null}

      {styleOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={() => setStyleOpen(false)}>
          <div
            className="h-full w-[min(440px,100vw)] overflow-y-auto border-l border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Board style"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl">Board style</h2>
              <button type="button" onClick={() => setStyleOpen(false)} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">Switches instantly, mid-game. Only you see your style.</p>
            <StyleCarousel compact />
          </div>
        </div>
      ) : null}
      <span className={cn("sr-only")} aria-live="assertive">
        {canAct ? (pending ? "Choose a figure or press S to skip" : "Your turn: place your tile") : ""}
      </span>
    </div>
  );
}
