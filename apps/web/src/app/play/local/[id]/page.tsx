"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { LocalEngineClient, randomSeedString, type AsyncEngine } from "@carcassonne/game-client";

import { GameScreen } from "@/components/game/game-screen";
import { loadCoreAssets } from "@/lib/core";
import { createEngine } from "@/lib/engine";
import { createLocalGame, getGame, saveGame, type LocalGameRecord } from "@/lib/local-games";
import { BOT_DELAY, getSettings } from "@/lib/settings";

export default function LocalGamePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rec, setRec] = useState<LocalGameRecord | null | undefined>(undefined);
  const [client, setClient] = useState<LocalEngineClient | null>(null);

  useEffect(() => {
    const r = getGame(id);
    setRec(r);
    if (!r) return;
    let disposed = false;
    let engine: AsyncEngine | null = null;
    let c: LocalEngineClient | null = null;
    void (async () => {
      const [core, eng] = await Promise.all([loadCoreAssets(), createEngine()]);
      engine = eng;
      if (disposed) return engine.dispose();
      c = new LocalEngineClient(
        engine,
        {
          ruleset: r.ruleset,
          seed: r.seed,
          players: r.players,
          moves: r.moves,
          aiDelayMs: BOT_DELAY[getSettings().botSpeed],
        },
        {
          catalog: core.catalog,
          onMoves: (moves, view) => {
            const ended = view.status === "ended";
            saveGame({
              ...r,
              moves: [...moves],
              status: view.status,
              scores: view.players.map((p) => p.score),
              updatedAt: Date.now(),
              finishedAt: ended ? Date.now() : null,
            });
          },
        },
      );
      setClient(c);
      await c.start();
    })();
    return () => {
      disposed = true;
      c?.dispose();
      engine?.dispose();
    };
  }, [id]);

  if (rec === null) {
    return (
      <div className="grid h-full place-items-center p-[var(--sp-6)] text-center">
        <div className="carc-sheet max-w-md">
          <h1 className="carc-heading">Game not found</h1>
          <p className="carc-sub">It may have been played in another browser.</p>
          <Link href="/play/new" className="carc-btn mt-[var(--sp-4)]" data-variant="primary">
            Start a new game
          </Link>
        </div>
      </div>
    );
  }
  if (!rec || !client) return <div className="h-full bg-[#a4743f]" aria-busy="true" />;

  const again = (sameSeed: boolean) => {
    const n = createLocalGame({
      mode: rec.mode,
      ruleset: rec.ruleset,
      seed: sameSeed ? rec.seed : randomSeedString(),
      players: rec.players,
      engine: rec.engine,
    });
    router.push(`/play/local/${n.id}` as Route);
  };

  return (
    <GameScreen
      client={client}
      title={rec.mode === "hotseat" ? "Hot-seat game" : rec.mode === "tutorial" ? "Tutorial" : "Game vs AI"}
      subtitle={<span className="font-mono">seed {rec.seed}</span>}
      hotseat={rec.mode === "hotseat"}
      coach={rec.mode === "ai"}
      exitHref="/"
      endActions={
        <>
          <Link href={`/replays/${rec.id}` as Route} className="carc-btn" data-variant="ghost">
            Watch replay
          </Link>
          <button type="button" className="carc-btn" onClick={() => again(true)}>
            Rematch, same seed
          </button>
          <button type="button" className="carc-btn" data-variant="primary" onClick={() => again(false)}>
            New game
          </button>
        </>
      }
    />
  );
}
