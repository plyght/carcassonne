"use client";

// The calm HUD: the board is the hero, and at rest only three quiet clusters show —
// the players (top-left), the dock with your tile and the one thing to do now
// (bottom-centre), and a feed of what just happened (top-right, under a row of icon
// actions). Everything else (the draw pile, reactions, keyboard help, settings, the
// seed) opens on demand from those clusters.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Castle,
  ExitFullscreen,
  FaceSmile,
  Fullscreen,
  History,
  Keyboard,
  Layers,
  Leaf,
  Lightbulb,
  Maximize,
  Minus,
  MoreH,
  Plus,
  Routing,
  Settings,
  Tree,
  Undo,
} from "reicon-react";

import type { EngineEvent, FeatureKind, TileId } from "@carcassonne/protocol";
import { tileLabel, type PlayerMeta, type Reaction, type TileCatalog } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLORS, TileThumb, type BoardCommands, type BoardPalette, type TileArtSource } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { popMotion } from "@/lib/motion";
import { useReducedMotion } from "@/lib/settings";

import { DialSurface } from "../dial/primitives";
import { RotationDial } from "../dial/rotation-dial";
import { playerName } from "./helpers";
import { Kbd, Panel, ReactionBar, ReactionBubbles, RemainingTiles, type FigureChoice } from "./hud-parts";

// ── an on-demand popover anchored to its button ────────────────────────────

function usePopover(open: boolean, close: () => void, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, anchor, panel]);
}

/** A popover that grows from its trigger (shared motion), placed above or below it. */
function Pop({
  open,
  className,
  origin,
  children,
  label,
  popRef,
  testId,
}: {
  open: boolean;
  className?: string;
  origin: string;
  children: ReactNode;
  label: string;
  popRef: RefObject<HTMLDivElement | null>;
  testId?: string;
}) {
  const pop = popMotion(useReducedMotion());
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={popRef}
          className={cn("carc-pop carc-hud-sheet pointer-events-auto", className)}
          role="dialog"
          aria-label={label}
          data-testid={testId}
          style={{ transformOrigin: origin }}
          initial={pop.initial}
          animate={pop.animate}
          exit={pop.exit}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ── top-right: icon actions + the menu ─────────────────────────────────────

export function HudActions({
  onRules,
  onUndo,
  canUndo,
  onHint,
  canHint,
  styleName,
  styleSwatch,
  styleOpen,
  onStyle,
  tableButton,
  tablePanel,
  exitHref,
  seed,
  showKeys,
  onToggleKeys,
}: {
  onRules(): void;
  onUndo?: () => void;
  canUndo?: boolean;
  onHint?: () => void;
  canHint?: boolean;
  styleName: string;
  styleSwatch: string;
  styleOpen: boolean;
  onStyle(): void;
  tableButton: RefObject<HTMLButtonElement | null>;
  tablePanel: ReactNode;
  exitHref: string;
  seed?: ReactNode;
  showKeys: boolean;
  onToggleKeys(): void;
}) {
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const closeMenu = () => setMenu(false);
  usePopover(menu, closeMenu, menuButton, menuPanel);
  const full = useFullscreen();
  return (
    <div className="carc-actions">
      <Panel className="carc-actions-bar carc-glass" role="toolbar" aria-label="Game actions">
        <button type="button" onClick={onRules} className="carc-icon-btn" title="How to play" aria-label="How to play" data-testid="how-to-play-button">
          <BookOpen />
        </button>
        {onUndo ? (
          <button type="button" onClick={onUndo} disabled={!canUndo} className="carc-icon-btn" title="Undo (U)" aria-label="Undo">
            <Undo />
          </button>
        ) : null}
        {onHint ? (
          <button type="button" onClick={onHint} disabled={!canHint} className="carc-icon-btn" title="Hint (H)" aria-label="Hint">
            <Lightbulb />
          </button>
        ) : null}
        <button
          ref={tableButton}
          type="button"
          onClick={onStyle}
          className="carc-icon-btn carc-style-btn"
          title={`Board style: ${styleName}`}
          aria-label="Table settings"
          aria-expanded={styleOpen}
          aria-haspopup="dialog"
          data-testid="style-button"
        >
          <span className="carc-style-swatch" style={{ background: styleSwatch }} aria-hidden />
        </button>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setMenu((m) => !m)}
          className="carc-icon-btn"
          title="Menu"
          aria-label="Menu"
          aria-expanded={menu}
          aria-haspopup="menu"
          data-testid="game-menu-button"
        >
          <MoreH />
        </button>
      </Panel>
      {tablePanel}
      <Pop open={menu} className="carc-menu-pop" origin="calc(100% - 22px) top" label="Game menu" popRef={menuPanel}>
        <div role="menu" className="carc-menu-list">
          <button type="button" role="menuitem" className="carc-menu-item" onClick={() => (onToggleKeys(), closeMenu())}>
            <Keyboard /> {showKeys ? "Hide keyboard help" : "Show keyboard help"} <Kbd>?</Kbd>
          </button>
          <button type="button" role="menuitem" className="carc-menu-item" onClick={() => (full.toggle(), closeMenu())}>
            {full.on ? <ExitFullscreen /> : <Fullscreen />} {full.on ? "Leave full screen" : "Full screen"}
          </button>
          <Link href="/settings" role="menuitem" className="carc-menu-item">
            <Settings /> Settings
          </Link>
          <Link href={exitHref as "/"} role="menuitem" className="carc-menu-item" aria-label="Leave game">
            <ArrowLeft /> Leave the game
          </Link>
        </div>
        {seed ? <p className="carc-menu-seed">{seed}</p> : null}
      </Pop>
    </div>
  );
}

function useFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return {
    on,
    toggle() {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    },
  };
}

// ── bottom-right: zoom ─────────────────────────────────────────────────────

export function ZoomStack({ commands, fitLabel }: { commands: RefObject<BoardCommands | null>; fitLabel: string }) {
  return (
    <Panel className="carc-zoom carc-glass" role="toolbar" aria-label="Board view" data-board-controls data-orientation="vertical">
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in (+)">
        <Plus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(0.8)} aria-label="Zoom out" title="Zoom out (−)">
        <Minus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.fit()} aria-label={fitLabel} title={`${fitLabel} (F)`}>
        <Maximize />
      </button>
    </Panel>
  );
}

// ── the dock: your tile, the one line about what to do, and the extras ─────

export function Dock({
  tile,
  rot,
  catalog,
  art,
  palette,
  hidden,
  canAct,
  pending,
  choices,
  onRotate,
  onChoose,
  onBack,
  onHoverChoice,
  waitingFor,
  thinking,
  legalRots,
  allowSkip = true,
  color,
  ended,
  remaining,
  showPile,
  reactions,
  players,
  onReact,
  hideBubbles,
  dialSize = 76,
}: {
  tile: TileId | null;
  rot: number;
  catalog: TileCatalog;
  art: TileArtSource;
  palette: BoardPalette;
  hidden: boolean;
  canAct: boolean;
  pending: boolean;
  choices: FigureChoice[];
  onRotate(dir: 1 | -1): void;
  onChoose(c: FigureChoice): void;
  onBack(): void;
  onHoverChoice?(c: FigureChoice | null): void;
  waitingFor: string | null;
  thinking?: boolean;
  legalRots?: number[];
  allowSkip?: boolean;
  color?: PlayerMeta["color"];
  ended: boolean;
  remaining: Record<string, number>;
  showPile: boolean;
  reactions: Reaction[];
  players: PlayerMeta[];
  onReact(e: string): void;
  hideBubbles?: boolean;
  dialSize?: number;
}) {
  const def = tile ? catalog.get(tile) : undefined;
  const interactive = canAct && !pending && !hidden && !!def;
  const tileSize = Math.round(dialSize * 0.62);
  const shown = choices.filter((c) => allowSkip || c.option !== null);
  const app = color ? PLAYER_COLORS[color] : null;
  const step = ended ? 0 : canAct ? (pending ? 2 : 1) : 0;
  const line = ended
    ? "The game is over."
    : canAct
      ? pending
        ? allowSkip
          ? "Claim something, or skip."
          : "Claim it with a meeple."
        : "Place your tile where it glows."
      : waitingFor
        ? thinking
          ? `${waitingFor} is thinking…`
          : `It is ${waitingFor}’s turn.`
        : "Waiting…";

  const [pileOpen, setPileOpen] = useState(false);
  const pileButton = useRef<HTMLButtonElement>(null);
  const pilePanel = useRef<HTMLDivElement>(null);
  usePopover(pileOpen, () => setPileOpen(false), pileButton, pilePanel);
  const [reactOpen, setReactOpen] = useState(false);
  const reactButton = useRef<HTMLButtonElement>(null);
  const reactPanel = useRef<HTMLDivElement>(null);
  usePopover(reactOpen, () => setReactOpen(false), reactButton, reactPanel);
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);

  return (
    <div className="carc-dock-wrap">
      <Panel className="carc-dock carc-glass" aria-label="Your turn" data-pending={pending || undefined} data-coach="hand">
        {!ended ? (
          <DialSurface className="carc-hand-dial" style={{ ["--dial" as string]: `${dialSize}px` }}>
            <RotationDial rot={rot} onRotate={onRotate} legal={interactive ? legalRots : undefined} disabled={!interactive} size={dialSize} tileSize={tileSize} label="Rotate the tile in hand">
              {def && !hidden ? (
                <TileThumb def={def} art={art} palette={palette} rot={rot} size={tileSize} title={`Tile ${def.id}, rotated ${rot * 90}°`} />
              ) : (
                <div className="carc-hand-hidden">?</div>
              )}
            </RotationDial>
          </DialSurface>
        ) : null}
        <div className="carc-dock-main">
          <p className="carc-dock-line" aria-live="polite">
            {step ? (
              <span className="carc-steps-dots" aria-label={`Step ${step} of 2`}>
                <span data-on={step >= 1 || undefined} />
                <span data-on={step >= 2 || undefined} />
              </span>
            ) : null}
            <span>{line}</span>
          </p>
          {pending ? (
            <div className="carc-figures" role="group" aria-label="Figure choice" data-coach="figures">
              {shown.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onChoose(c)}
                  onPointerEnter={() => onHoverChoice?.(c)}
                  onPointerLeave={() => onHoverChoice?.(null)}
                  onFocus={() => onHoverChoice?.(c)}
                  onBlur={() => onHoverChoice?.(null)}
                  className="carc-figure"
                  data-skip={c.option === null || undefined}
                  title={c.detail || undefined}
                  aria-keyshortcuts={c.option === null ? "S" : c.key === "recall" ? "A" : String(i + 1)}
                >
                  {app && c.option && c.key !== "recall" ? (
                    <span className="carc-figure-token" style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink }} aria-hidden>
                      <FigureIcon kind={c.option.type === "abbot" ? "abbot" : "meeple"} fill="currentColor" ink={app.fill} outline="none" marker={app.marker} size={16} />
                    </span>
                  ) : null}
                  <span className="carc-figure-label">{c.label}</span>
                </button>
              ))}
              <button type="button" onClick={onBack} className="carc-figure carc-figure-back" title="Put the tile somewhere else (Esc)">
                Move the tile
              </button>
            </div>
          ) : null}
        </div>
        <div className="carc-dock-end">
          {showPile && !ended ? (
            <button
              ref={pileButton}
              type="button"
              className="carc-chip-btn"
              onClick={() => setPileOpen((o) => !o)}
              aria-expanded={pileOpen}
              aria-haspopup="dialog"
              title="The tiles still to come"
              data-coach="pile"
            >
              <Layers aria-hidden /> <span className="carc-num">{total}</span> left
            </button>
          ) : null}
          <button
            ref={reactButton}
            type="button"
            className="carc-icon-btn carc-react-btn"
            onClick={() => setReactOpen((o) => !o)}
            aria-expanded={reactOpen}
            aria-label="Reactions"
            title="Reactions"
          >
            <FaceSmile />
          </button>
        </div>
      </Panel>
      <Pop open={pileOpen} className="carc-pile-pop" origin="calc(100% - 80px) bottom" label="Draw pile" popRef={pilePanel}>
        <RemainingTiles remaining={remaining} catalog={catalog} art={art} palette={palette} />
      </Pop>
      <Pop open={reactOpen} className="carc-react-pop" origin="calc(100% - 26px) bottom" label="Reactions" popRef={reactPanel}>
        <ReactionBar onReact={onReact} />
      </Pop>
      {/* the Kahoot bubbles fly out of the dock, whether or not the row is open */}
      {!hideBubbles ? <ReactionBubbles reactions={reactions} players={players} /> : null}
    </div>
  );
}

// ── the feed: what just happened, like a kill feed ─────────────────────────

const KIND_ICON: Partial<Record<FeatureKind, typeof Castle>> = { road: Routing, city: Castle, cloister: Bell, field: Tree, garden: Leaf };
const KIND_NAME: Record<FeatureKind, string> = { road: "road", city: "city", cloister: "cloister", field: "field", garden: "garden", river: "river" };

export interface FeedEntry {
  key: string;
  at: number;
  player: number | null;
  /** "claimed a city" — the name is drawn in bold before it. */
  text: string;
  kind?: FeatureKind;
  score?: boolean;
}

/** One move's events as terse feed lines (the full sentences live in the rules and guide). */
export function feedLines(seq: number, events: EngineEvent[], catalog: TileCatalog, at: number): FeedEntry[] {
  const out: FeedEntry[] = [];
  const placed = events.find((e): e is Extract<EngineEvent, { type: "tilePlaced" }> => e.type === "tilePlaced");
  const figure = events.find((e): e is Extract<EngineEvent, { type: "figurePlaced" }> => e.type === "figurePlaced");
  const recalled = events.find((e): e is Extract<EngineEvent, { type: "abbotRecalled" }> => e.type === "abbotRecalled");
  if (placed) {
    const def = catalog.get(placed.tile);
    if (figure && figure.player === placed.player) {
      const kind = def?.features[figure.feature]?.kind ?? "field";
      out.push({ key: `${seq}-p`, at, player: placed.player, kind, text: figure.figure === "abbot" ? `sent the abbot to a ${KIND_NAME[kind]}` : `claimed a ${KIND_NAME[kind]}` });
    } else {
      out.push({ key: `${seq}-p`, at, player: placed.player, text: `placed ${tileLabel(catalog, placed.tile)}` });
    }
  }
  if (recalled) out.push({ key: `${seq}-a`, at, player: recalled.player, kind: "cloister", score: true, text: `brought the abbot home for ${recalled.points}` });
  events.forEach((e, i) => {
    if (e.type === "featureScored" && e.points > 0)
      e.winners.forEach((w, k) => out.push({ key: `${seq}-s${i}-${k}`, at, player: w, kind: e.kind, score: true, text: `scored ${e.points} for a ${KIND_NAME[e.kind]}` }));
    if (e.type === "tileDiscarded") out.push({ key: `${seq}-d${i}`, at, player: null, text: "A tile fit nowhere and was set aside." });
    if (e.type === "gameEnded") out.push({ key: `${seq}-end`, at, player: null, score: true, text: "The last tile is down and the final scoring is done." });
  });
  return out;
}

const FEED_TTL = 7000;
const FEED_MAX = 5;

export function Feed({ entries, players }: { entries: FeedEntry[]; players: PlayerMeta[] }) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useLayoutEffect(() => {
    if (expanded && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [expanded, entries.length]);
  const live = entries.filter((e) => now - e.at < FEED_TTL).slice(-FEED_MAX);
  const shown = expanded ? entries : live;
  const enter = reduced ? { opacity: 0 } : { opacity: 0, filter: "blur(6px)" };
  return (
    <div className="carc-feed" data-expanded={expanded || undefined} onMouseLeave={() => setExpanded(false)} aria-label="What happened">
      <button
        type="button"
        className="carc-feed-history"
        onClick={() => setExpanded((x) => !x)}
        onMouseEnter={() => setExpanded(true)}
        aria-expanded={expanded}
        title="Everything that happened"
        aria-label="Show everything that happened"
        disabled={!entries.length}
      >
        <History />
      </button>
      <ol ref={scroller} className="carc-feed-list" aria-live="polite">
        <AnimatePresence initial={false}>
          {shown.map((e) => {
            const meta = e.player === null ? null : players[e.player];
            const app = meta ? PLAYER_COLORS[meta.color] : null;
            const Icon = e.kind ? KIND_ICON[e.kind] : undefined;
            return (
              <motion.li
                key={e.key}
                layout={reduced ? false : "position"}
                className="carc-feed-line"
                data-score={e.score || undefined}
                style={app ? { ["--seat" as string]: app.fill } : undefined}
                initial={enter}
                animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, filter: reduced ? "blur(0px)" : "blur(4px)", transition: { duration: 0.4 } }}
                transition={{ layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
              >
                {app ? <span className="carc-feed-dot" aria-hidden /> : null}
                <span className="carc-feed-text">
                  {e.player !== null ? <strong>{playerName(players, e.player)}</strong> : null} {e.text}
                </span>
                {Icon ? <Icon className="carc-feed-icon" aria-hidden /> : null}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}

/** Keyboard help, shown on demand (the menu or "?") and during the first game. */
export function KeyHelp({ is3d }: { is3d: boolean }) {
  return (
    <Panel className="carc-keyhelp carc-glass" aria-label="Keyboard help">
      {is3d ? (
        <>
          <span>
            <Kbd>R</Kbd> or scroll to rotate
          </span>
          <span>Drag to orbit</span>
          <span>
            <Kbd>F</Kbd> reframe
          </span>
        </>
      ) : (
        <>
          <span>
            <Kbd>R</Kbd> rotate
          </span>
          <span>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> choose a spot
          </span>
          <span>
            <Kbd>Enter</Kbd> place
          </span>
          <span>
            <Kbd>S</Kbd> skip
          </span>
          <span>
            <Kbd>F</Kbd> fit
          </span>
        </>
      )}
    </Panel>
  );
}
