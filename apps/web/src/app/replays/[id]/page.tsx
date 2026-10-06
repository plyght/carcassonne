"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pause, Play, SkipPrev, SkipNext } from "reicon-react";

import { simulateReplay, viewAtPly, type SimulatedReplay } from "@carcassonne/game-client";
import { ClassicBoard, hudPalette, is3DStyle, PLAYER_COLOR_ORDER, renderableStyle, type BoardCommands } from "@carcassonne/render-classic";

import { Board3D, type Board3DBatch } from "@/components/board3d/board-3d";
import { describeEvent, playerName } from "@/components/game/helpers";
import { BoardToolbar, Panel, ScorePanel } from "@/components/game/hud-parts";
import { CameraIconSwitch } from "@/components/dial/table-controls";
import { useCore } from "@/lib/core";
import { createEngine } from "@/lib/engine";
import { getGame, type LocalGameRecord } from "@/lib/local-games";
import { fallbackToClassic, useBoardCamera } from "@/lib/board-controls";
import { useDebugFlag, useReducedMotion, useSettings } from "@/lib/settings";

export default function ReplayViewer() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<LocalGameRecord | null | undefined>(undefined);
  const [rep, setRep] = useState<SimulatedReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `seq` / `step` let the 3D board tell a single step forward (animate that ply's
  // events) from a scrub (rebuild the view).
  const [nav, setNav] = useState({ ply: 0, seq: 0, step: false });
  const ply = nav.ply;
  const setPly = useCallback(
    (u: number | ((p: number) => number)) =>
      setNav((n) => {
        const next = typeof u === "function" ? u(n.ply) : u;
        return next === n.ply ? n : { ply: next, seq: n.seq + 1, step: next === n.ply + 1 };
      }),
    [],
  );
  const [playing, setPlaying] = useState(false);
  const settings = useSettings();
  const reduced = useReducedMotion();
  const style = renderableStyle(settings.style);
  const palette = hudPalette(style);
  const debug = useDebugFlag();
  const core = useCore();
  const { camera, choose: chooseCamera, report: setCamera } = useBoardCamera(style);
  const catalog = core?.catalog;
  const commands = useRef<BoardCommands | null>(null);
  const [insets, setInsets] = useState({ top: 76, right: 12, bottom: 124, left: 324 });
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setInsets(w >= 768 ? { top: 76, right: 12, bottom: 124, left: 12 + (w >= 1024 ? 304 : 280) + 8 } : { top: 128, right: 8, bottom: 180, left: 8 });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const r = getGame(id);
    setRec(r);
    if (!r) return;
    let alive = true;
    void (async () => {
      const engine = await createEngine();
      try {
        const sim = await simulateReplay(engine, r);
        if (alive) {
          setRep(sim);
          setPly(sim.plies.length);
        }
      } catch (e) {
        if (alive) setError(String((e as Error).message));
      } finally {
        engine.dispose();
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const total = rep?.plies.length ?? 0;
  const view = useMemo(() => (rep ? viewAtPly(rep, ply, catalog) : null), [rep, ply, catalog]);
  const prev = useMemo(() => (rep && ply > 0 ? viewAtPly(rep, ply - 1, catalog) : null), [rep, ply, catalog]);
  const batches = useMemo<Board3DBatch[]>(
    () => (rep && nav.step && nav.ply > 0 ? [{ seq: nav.seq, events: rep.plies[nav.ply - 1]! }] : []),
    [rep, nav],
  );
  const playerSlots = useMemo(() => rec?.players.map((p) => Math.max(0, PLAYER_COLOR_ORDER.indexOf(p.color))), [rec]);

  useEffect(() => {
    if (!playing) return;
    if (ply >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPly((p) => Math.min(total, p + 1)), 700);
    return () => clearTimeout(t);
  }, [playing, ply, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setPly((p) => Math.min(total, p + 1));
      else if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((x) => !x);
      } else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(total);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, setPly]);

  if (rec === null)
    return (
      <div className="carc-page">
        <div className="carc-sheet carc-empty">
          <h1 className="carc-heading">Replay not found</h1>
          <p className="carc-sub">It may have been played in another browser.</p>
          <Link href="/replays" className="carc-btn mt-[var(--sp-2)]">
            All replays
          </Link>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="carc-page">
        <p className="carc-notice" data-tone="danger" role="alert">
          {error}
        </p>
      </div>
    );
  if (!rec || !rep || !view || !catalog)
    return (
      <div className="grid h-full place-items-center">
        <div className="carc-title animate-pulse text-[var(--text-2)]">Re-simulating…</div>
      </div>
    );

  const batch = ply > 0 ? rep.plies[ply - 1]! : [];
  const placed = batch.find((e) => e.type === "tilePlaced");
  const mover = ply > 0 ? rep.movers[ply - 1]! : null;
  const deltas = prev ? view.players.map((p, i) => p.score - prev.players[i]!.score) : [];

  const pct = total ? (ply / total) * 100 : 0;
  return (
    <div className="carc-game">
      {is3DStyle(style) && core ? (
        <Board3D
          geo={core.geo}
          styleId={style.id}
          camera={camera}
          onCameraChange={setCamera}
          tier={settings.tier}
          reducedMotion={reduced}
          debug={debug}
          view={view}
          batches={batches}
          playerSlots={playerSlots}
          onFail={fallbackToClassic}
          insets={insets}
          commandsRef={commands}
          controls={false}
          ariaLabel="Replay board (3D)"
        />
      ) : (
        <ClassicBoard
          view={view}
          catalog={catalog}
          palette={palette}
          players={rec.players}
          lastPlaced={placed && placed.type === "tilePlaced" ? { x: placed.x, y: placed.y } : null}
          reducedMotion={reduced}
          ariaLabel="Replay board"
          autoFit
          insets={insets}
          commandsRef={commands}
          controls={false}
        />
      )}
      <div className="carc-hud-top">
        <Panel className="carc-titlebar carc-hud-bar carc-replay-bar">
          <Link href="/replays" className="carc-icon-btn" aria-label="Back to replays" title="Back to replays">
            <ArrowLeft />
          </Link>
          <div className="carc-titlebar-text">
            <div className="carc-titlebar-title">Replay</div>
            <div className="carc-replay-seed">
              Seed <span className="font-mono">{rec.seed}</span>
            </div>
          </div>
          {is3DStyle(style) && core ? <CameraIconSwitch value={camera} onChange={chooseCamera} /> : null}
        </Panel>
      </div>
      <div className="carc-hud-left carc-replay-left">
        <ScorePanel view={view} players={rec.players} localSeats={[]} reactions={[]} hideReactions thinking={false} palette={palette} />
      </div>
      <div className="carc-hud-bottom carc-replay-bottom">
        <div className="carc-hud-bottom-start" />
        <div className="carc-hud-bottom-center">
          <Panel className="carc-transport">
            <div className="carc-transport-caption" aria-live="polite">
              {ply === 0 ? (
                <strong>Start of game</strong>
              ) : (
                <>
                  <strong>
                    Turn <span className="carc-num">{ply}</span>: {playerName(rec.players, mover)}
                  </strong>
                  {deltas.map((d, i) => (d ? <span key={i} className="carc-num">{`${playerName(rec.players, i)} +${d}`}</span> : null))}
                  {batch.map((e, i) => {
                    const t = describeEvent(e, rec.players);
                    return t && e.type !== "featureScored" ? <span key={i}>{t}</span> : null;
                  })}
                </>
              )}
            </div>
            <div className="carc-transport-controls">
              <button type="button" className="carc-icon-btn" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Step back" title="Step back (←)">
                <SkipPrev />
              </button>
              <button
                type="button"
                className="carc-icon-btn"
                data-variant="primary"
                onClick={() => {
                  if (ply >= total) setPly(0);
                  setPlaying((x) => !x);
                }}
                aria-label={playing ? "Pause" : "Play"}
                title={playing ? "Pause (Space)" : "Play (Space)"}
              >
                {playing ? <Pause /> : <Play />}
              </button>
              <button type="button" className="carc-icon-btn" onClick={() => setPly((p) => Math.min(total, p + 1))} aria-label="Step forward" title="Step forward (→)">
                <SkipNext />
              </button>
              <input
                type="range"
                min={0}
                max={total}
                value={ply}
                onChange={(e) => {
                  setPlaying(false);
                  setPly(Number(e.target.value));
                }}
                className="carc-range"
                style={{ ["--pct" as string]: `${pct}%` }}
                aria-label="Scrub turns"
              />
              <span className="carc-transport-count carc-num">
                {ply} / {total}
              </span>
            </div>
          </Panel>
        </div>
        <div className="carc-hud-bottom-end">
          <BoardToolbar commands={commands} fitLabel={is3DStyle(style) ? "Reframe the board" : "Fit board"} />
        </div>
      </div>
    </div>
  );
}
