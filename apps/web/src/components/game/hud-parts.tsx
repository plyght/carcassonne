"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@carcassonne/ui/lib/utils";
import { Bot, Castle, ChevronDown, Church, Flower2, Maximize, Minus, Plus, Route, SmilePlus, Timer, Wheat } from "lucide-react";

import { REACTIONS, type FigureOption, type GameView, type TileId } from "@carcassonne/protocol";
import type { PlayerMeta, Reaction, TileCatalog } from "@carcassonne/game-client";
import {
  FigureIcon,
  PLAYER_COLORS,
  playerFill,
  TileThumb,
  type BoardCommands,
  type BoardPalette,
  type TileArtSource,
} from "@carcassonne/render-classic";

import { DialSurface } from "../dial/primitives";
import { RotationDial } from "../dial/rotation-dial";
import { FEATURE_LABEL, FIGURE_ROLE, formatClock, playerName, type Projection } from "./helpers";

/** A floating cardstock panel over the board. */
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("carc-hud-sheet pointer-events-auto", className)} {...rest}>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="carc-kbd">{children}</kbd>;
}

export function Tag({ tone, children, className }: { tone?: "accent" | "gold" | "danger"; children: ReactNode; className?: string }) {
  return (
    <span className={cn("carc-tag", className)} data-tone={tone}>
      {children}
    </span>
  );
}

// ── score panel ─────────────────────────────────────────────────────────────

const CATS = [
  { key: "road", icon: Route, label: "Roads" },
  { key: "city", icon: Castle, label: "Cities" },
  { key: "cloister", icon: Church, label: "Cloisters" },
  { key: "garden", icon: Flower2, label: "Gardens" },
  { key: "field", icon: Wheat, label: "Fields" },
] as const;

const TIER_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

export function ScorePanel({
  view,
  players,
  localSeats,
  reactions,
  hideReactions,
  thinking,
  palette,
  footer,
}: {
  view: GameView;
  players: PlayerMeta[];
  localSeats: number[];
  reactions: Reaction[];
  hideReactions: boolean;
  thinking: boolean;
  palette: BoardPalette;
  /** A quiet last line (e.g. the seed). */
  footer?: ReactNode;
}) {
  const leader = Math.max(...view.players.map((p) => p.score));
  return (
    <>
      {/* compact strip for phones */}
      <Panel className="carc-score-strip" aria-label="Scores">
        {view.players.map((p, i) => {
          const color = players[i]?.color ?? "red";
          const app = PLAYER_COLORS[color];
          const active = view.status === "playing" && view.currentPlayer === i;
          return (
            <div key={i} className="carc-score-chip" data-active={active || undefined} aria-current={active ? "true" : undefined}>
              <FigureIcon fill={playerFill(palette, color)} ink={app.ink} marker={app.marker} size={20} />
              <span className="carc-score-chip-name">{playerName(players, i)}</span>
              <span className="carc-score-chip-score carc-num" data-leader={p.score === leader && leader > 0 ? "true" : undefined}>
                {p.score}
              </span>
              {!hideReactions
                ? reactions
                    .filter((r) => r.player === i)
                    .map((r) => (
                      <span key={r.id} className="reaction-float carc-reaction" aria-hidden>
                        {r.emoji}
                      </span>
                    ))
                : null}
            </div>
          );
        })}
      </Panel>
      <Panel className="carc-score-panel" aria-label="Scores">
        <ol className="carc-score-list">
          {view.players.map((p, i) => {
            const meta = players[i];
            const color = meta?.color ?? "red";
            const app = PLAYER_COLORS[color];
            const active = view.status === "playing" && view.currentPlayer === i;
            const mine = reactions.filter((r) => r.player === i);
            const you = localSeats.includes(i) && localSeats.length === 1 && playerName(players, i) !== "You";
            return (
              <li key={i} className="carc-score-row" data-active={active || undefined} aria-current={active ? "true" : undefined}>
                <span className="carc-score-avatar" style={{ ["--seat" as string]: playerFill(palette, color) }}>
                  <FigureIcon fill={playerFill(palette, color)} ink={app.ink} marker={app.marker} size={24} title={`${app.label} meeple`} />
                </span>
                <div className="carc-score-who">
                  <div className="carc-score-name-line">
                    <span className="carc-score-name">{playerName(players, i)}</span>
                    {you ? <Tag tone="accent">You</Tag> : null}
                    {meta?.kind === "bot" ? (
                      <Tag>
                        <Bot aria-hidden />
                        <span className="sr-only">Bot, </span>
                        {TIER_LABEL[meta.tier ?? ""] ?? meta.tier}
                      </Tag>
                    ) : null}
                    {meta?.connected === false ? <Tag tone="danger">Offline</Tag> : null}
                  </div>
                  <div className="carc-score-supply" aria-label={`${p.meeples} meeples in supply`}>
                    {Array.from({ length: 7 }, (_, k) => (
                      <FigureIcon
                        key={k}
                        fill={k < p.meeples ? playerFill(palette, color) : "transparent"}
                        outline={k < p.meeples ? "rgba(0,0,0,0.45)" : "color-mix(in oklch, currentColor 40%, transparent)"}
                        ink={k < p.meeples ? app.ink : "transparent"}
                        marker={app.marker}
                        size={14}
                      />
                    ))}
                    {view.ruleset.abbot ? (
                      <span className="carc-score-abbot" title={p.abbotAvailable ? "Abbot in supply" : "Abbot on the board"}>
                        <FigureIcon
                          kind="abbot"
                          fill={p.abbotAvailable ? playerFill(palette, color) : "transparent"}
                          outline={p.abbotAvailable ? "rgba(0,0,0,0.45)" : "color-mix(in oklch, currentColor 40%, transparent)"}
                          ink={p.abbotAvailable ? app.ink : "transparent"}
                          marker={app.marker}
                          size={14}
                        />
                      </span>
                    ) : null}
                    {active && thinking ? <span className="carc-score-thinking">thinking…</span> : null}
                  </div>
                </div>
                <div className="carc-score-total carc-num" data-leader={p.score === leader && leader > 0 ? "true" : undefined}>
                  {p.score}
                </div>
                <div className="carc-score-cats">
                  {CATS.filter((c) => c.key !== "garden" || view.ruleset.abbot).map(({ key, icon: Icon, label }) => (
                    <span key={key} className="carc-score-cat carc-num" title={label}>
                      <Icon aria-hidden />
                      <span className="sr-only">{label}</span>
                      {p.breakdown[key]}
                    </span>
                  ))}
                </div>
                {!hideReactions
                  ? mine.map((r) => (
                      <span key={r.id} className="reaction-float carc-reaction" aria-hidden>
                        {r.emoji}
                      </span>
                    ))
                  : null}
              </li>
            );
          })}
        </ol>
        {footer ? <div className="carc-score-footer">{footer}</div> : null}
      </Panel>
    </>
  );
}

// ── tile in hand + figure choice ────────────────────────────────────────────

export interface FigureChoice {
  key: string;
  label: string;
  detail: string;
  option: FigureOption | { type: "recallAbbot" } | null;
}

export function figureChoices(
  options: FigureOption[],
  tile: TileId,
  catalog: TileCatalog,
  recall: { points: number } | null,
): FigureChoice[] {
  const def = catalog.get(tile);
  const out: FigureChoice[] = options.map((o, i) => {
    const kind = def?.features[o.feature]?.kind ?? "field";
    const same = options.filter((x) => (def?.features[x.feature]?.kind ?? "") === kind && x.type === o.type);
    const nth = same.length > 1 ? ` ${same.indexOf(o) + 1}` : "";
    return {
      key: `${o.type}-${o.feature}-${i}`,
      label: o.type === "abbot" ? `Abbot on ${FEATURE_LABEL[kind]}` : `Meeple on ${FEATURE_LABEL[kind]}${nth}`,
      detail: o.type === "abbot" ? "abbot" : FIGURE_ROLE[kind],
      option: o,
    };
  });
  if (recall) out.push({ key: "recall", label: "Recall abbot", detail: `+${recall.points} now`, option: { type: "recallAbbot" } });
  out.push({ key: "skip", label: "No figure", detail: "skip", option: null });
  return out;
}

export function TileInHand({
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
  waitingFor,
  discardsNote,
  legalRots,
  dialSize = 112,
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
  waitingFor: string | null;
  discardsNote?: string | null;
  /** Rotations legal at the hovered spot (marked on the dial). */
  legalRots?: number[];
  dialSize?: number;
}) {
  const def = tile ? catalog.get(tile) : undefined;
  const interactive = canAct && !pending && !hidden && !!def;
  const tileSize = Math.round(dialSize * 0.6);
  return (
    <Panel className="carc-hand" aria-label="Tile in hand" data-pending={pending || undefined}>
      <div className="carc-hand-top">
        <DialSurface className="carc-hand-dial" style={{ ["--dial" as string]: `${dialSize}px` }}>
          <RotationDial
            rot={rot}
            onRotate={onRotate}
            legal={interactive ? legalRots : undefined}
            disabled={!interactive}
            size={dialSize}
            tileSize={tileSize}
            label="Rotate the tile in hand"
          >
            {def && !hidden ? (
              // Rotation is painted into the art (not CSS-rotated), so the cloister, houses and lighting stay upright.
              <TileThumb def={def} art={art} palette={palette} rot={rot} size={tileSize} title={`Tile ${def.id}, rotated ${rot * 90}°`} />
            ) : (
              <div className="carc-hand-hidden" style={{ background: palette.table }}>
                ?
              </div>
            )}
          </RotationDial>
        </DialSurface>
        <div className="carc-hand-text">
          <div className="carc-eyebrow">Tile in hand</div>
          {canAct && !pending ? (
            <>
              <p className="carc-hand-status">Click a glowing spot to place it.</p>
              <p className="carc-hand-hint">
                Turn the dial, scroll, or press <Kbd>R</Kbd>
              </p>
            </>
          ) : null}
          {pending ? (
            <>
              <p className="carc-hand-status">Place a figure?</p>
              <p className="carc-hand-hint">Tap a spot on the tile, or pick one here.</p>
            </>
          ) : null}
          {!canAct ? <p className="carc-hand-status" data-quiet="true">{waitingFor ? `Waiting for ${waitingFor}…` : "Game over"}</p> : null}
          {discardsNote ? <p className="carc-hand-hint" data-tone="warn">{discardsNote}</p> : null}
        </div>
      </div>
      {pending ? (
        <div className="carc-figures" role="group" aria-label="Figure choice">
          <div className="carc-figure-list">
            {choices.map((c, i) => (
              <button key={c.key} type="button" onClick={() => onChoose(c)} className="carc-figure" data-skip={c.option === null || undefined}>
                <Kbd>{c.option === null ? "S" : c.key === "recall" ? "A" : i + 1}</Kbd>
                <span className="carc-figure-label">{c.label}</span>
                <span className="carc-figure-detail">{c.detail}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onBack} className="carc-btn carc-figure-back" data-variant="ghost" data-size="compact">
            Pick another spot <Kbd>Esc</Kbd>
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

// ── remaining tiles ─────────────────────────────────────────────────────────

export function RemainingTiles({
  remaining,
  catalog,
  art,
  palette,
}: {
  remaining: Record<string, number>;
  catalog: TileCatalog;
  art: TileArtSource;
  palette: BoardPalette;
}) {
  const [open, setOpen] = useState(true);
  // Engine order; ids the ruleset never uses (River off, the spring) are not in `remaining`.
  const ids = catalog.all().map((d) => d.id).filter((id) => id in remaining);
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  return (
    <Panel className="carc-pile" aria-label="Remaining tiles">
      <button type="button" className="carc-pile-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="carc-eyebrow">Draw pile</span>
        <span className="carc-pile-total carc-num">
          {total} <span className="carc-pile-unit">{total === 1 ? "tile" : "tiles"}</span>
        </span>
        <ChevronDown className="carc-pile-chevron" aria-hidden />
      </button>
      {open ? (
        <ul className="carc-pile-grid">
          {ids.map((id) => {
            const def = catalog.get(id)!;
            const n = remaining[id] ?? 0;
            return (
              <li key={id} className="carc-pile-cell" data-empty={n === 0 || undefined} title={`${id}: ${n} left`}>
                <TileThumb def={def} art={art} palette={palette} size={32} title={`Tile ${id}, ${n} left`} />
                <span className="carc-pile-count carc-num">{n}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Panel>
  );
}

// ── reactions ───────────────────────────────────────────────────────────────

export function ReactionBar({ onReact, disabled }: { onReact(e: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const quick = REACTIONS.slice(0, 6);
  const shown = open ? REACTIONS : quick;
  return (
    <Panel className="carc-reactions" data-open={open || undefined} aria-label="Emoji reactions">
      <div className="carc-reaction-grid">
        {shown.map((e, i) => (
          <button
            key={e}
            type="button"
            disabled={disabled}
            onClick={() => onReact(e)}
            className="carc-emoji"
            data-extra={i >= 4 && !open ? "true" : undefined}
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="carc-icon-btn carc-reaction-more"
        aria-expanded={open}
        aria-label={open ? "Fewer reactions" : `${REACTIONS.length - quick.length} more reactions`}
        title={open ? "Fewer reactions" : "More reactions"}
      >
        {open ? <ChevronDown /> : <SmilePlus />}
      </button>
    </Panel>
  );
}

// ── board toolbar ───────────────────────────────────────────────────────────

/** Zoom in / out / fit for either board (the boards' own buttons are switched off). */
export function BoardToolbar({ commands, fitLabel = "Fit board", className }: { commands: RefObject<BoardCommands | null>; fitLabel?: string; className?: string }) {
  return (
    <Panel className={cn("carc-hud-toolbar", className)} role="toolbar" aria-label="Board view" data-board-controls data-orientation="horizontal">
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(0.8)} aria-label="Zoom out" title="Zoom out (−)">
        <Minus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in (+)">
        <Plus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.fit()} aria-label={fitLabel} title={`${fitLabel} (F)`}>
        <Maximize />
      </button>
    </Panel>
  );
}

/** Keyboard and pointer help, on wide screens. */
export function BoardHelp({ is3d }: { is3d: boolean }) {
  return (
    <Panel className="carc-hud-help" aria-label="Board controls">
      <div className="carc-board-help">
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
              <Kbd>F</Kbd> fit
            </span>
            <span>Drag to pan</span>
          </>
        )}
      </div>
    </Panel>
  );
}

// ── clock ───────────────────────────────────────────────────────────────────

export function TurnClock({ startedAt, deadline }: { startedAt: number; deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = deadline ? formatClock(deadline - now) : formatClock(now - startedAt);
  const urgent = deadline !== null && deadline - now < 10_000;
  return (
    <span className="carc-clock carc-num" data-urgent={urgent || undefined} title={deadline ? "Time left this turn" : "Time this turn"} suppressHydrationWarning>
      <Timer aria-hidden />
      {label}
    </span>
  );
}

// ── feature hover info ──────────────────────────────────────────────────────

export function FeatureInfo({ p, players }: { p: Projection; players: PlayerMeta[] }) {
  return (
    <Panel className="carc-feature" aria-live="polite">
      <div className="carc-feature-head">
        <span className="carc-feature-kind">{FEATURE_LABEL[p.kind]}</span>
        <span className="carc-feature-meta carc-num">
          {p.tiles} tile{p.tiles === 1 ? "" : "s"}
          {p.pennants ? ` · ${p.pennants} pennant${p.pennants === 1 ? "" : "s"}` : ""}
          {p.complete ? " · complete" : ""}
        </span>
      </div>
      <div className="carc-feature-body carc-num">
        {p.holders.length ? (
          <span>
            Held by{" "}
            {p.holders.map((h, i) => (
              <span key={h} className="carc-feature-holder">
                {i ? " & " : ""}
                <span className="carc-feature-dot" style={{ background: PLAYER_COLORS[players[h]?.color ?? "red"].fill }} aria-hidden />
                {playerName(players, h)}
              </span>
            ))}
          </span>
        ) : (
          <span>Unclaimed</span>
        )}
        <span className="carc-feature-meta">
          {" · "}
          {p.ifCompleted !== null && !p.complete ? `${p.ifCompleted} if completed · ` : ""}
          {p.atEnd} at game end
        </span>
      </div>
    </Panel>
  );
}
