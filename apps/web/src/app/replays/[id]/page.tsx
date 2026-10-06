"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { simulateReplay, viewAtPly, type SimulatedReplay } from "@carcassonne/game-client";
import { ClassicBoard, hudPalette, is3DStyle, PLAYER_COLOR_ORDER, renderableStyle } from "@carcassonne/render-classic";

import { Board3D, type Board3DBatch } from "@/components/board3d/board-3d";
import { describeEvent, playerName } from "@/components/game/helpers";
import { Panel, ScorePanel } from "@/components/game/hud-parts";
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

  if (rec === null) return <div className="p-10 text-center">Replay not found.</div>;
  if (error) return <div className="p-10 text-center text-destructive">{error}</div>;
  if (!rec || !rep || !view || !catalog) return <div className="grid h-full place-items-center font-display text-2xl">Re-simulating…</div>;

  const batch = ply > 0 ? rep.plies[ply - 1]! : [];
  const placed = batch.find((e) => e.type === "tilePlaced");
  const mover = ply > 0 ? rep.movers[ply - 1]! : null;
  const deltas = prev ? view.players.map((p, i) => p.score - prev.players[i]!.score) : [];

  return (
    <div className="relative h-full min-h-0">
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
          insets={{ top: 20, right: 20, bottom: 130, left: 330 }}
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
          insets={{ top: 20, right: 20, bottom: 130, left: 330 }}
        />
      )}
      <div className="pointer-events-none absolute top-3 left-3 flex w-[min(300px,calc(100vw-24px))] flex-col gap-2">
        <Panel className="flex items-center gap-2 px-3 py-2">
          <Link href="/replays" className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="Back to replays">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="font-display">Replay</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">seed {rec.seed}</div>
          </div>
          {is3DStyle(style) && core ? (
            <div className="ml-auto">
              <CameraIconSwitch value={camera} onChange={chooseCamera} />
            </div>
          ) : null}
        </Panel>
        <ScorePanel view={view} players={rec.players} localSeats={[]} reactions={[]} hideReactions thinking={false} palette={palette} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
        <Panel className="w-[min(720px,100%)] p-3">
          <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 text-xs text-muted-foreground" aria-live="polite">
            {ply === 0 ? (
              <span>Start of game</span>
            ) : (
              <>
                <span className="font-semibold text-foreground">
                  Turn {ply}: {playerName(rec.players, mover)}
                </span>
                {deltas.map((d, i) => (d ? <span key={i}>{`${playerName(rec.players, i)} +${d}`}</span> : null))}
                {batch.map((e, i) => {
                  const t = describeEvent(e, rec.players);
                  return t && e.type !== "featureScored" ? <span key={i}>{t}</span> : null;
                })}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg p-2 hover:bg-muted" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Step back">
              <SkipBack className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary p-2 text-primary-foreground"
              onClick={() => {
                if (ply >= total) setPly(0);
                setPlaying((x) => !x);
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button type="button" className="rounded-lg p-2 hover:bg-muted" onClick={() => setPly((p) => Math.min(total, p + 1))} aria-label="Step forward">
              <SkipForward className="size-4" />
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
              className="flex-1 accent-[var(--primary)]"
              aria-label="Scrub turns"
            />
            <span className="w-16 text-right font-mono text-xs tabular-nums">
              {ply}/{total}
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
