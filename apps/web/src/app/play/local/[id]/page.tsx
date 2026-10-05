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
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-3xl">Game not found</h1>
          <p className="mt-2 text-muted-foreground">It may have been played in another browser.</p>
          <Link href="/play/new" className="mt-4 inline-block font-semibold text-primary underline">
            Start a new game
          </Link>
        </div>
      </div>
    );
  }
  if (!rec || !client) return <div className="h-full bg-[#a4743f]" />;

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

  const btn = "rounded-xl px-4 py-2 text-sm font-semibold transition-colors";
  return (
    <GameScreen
      client={client}
      title={rec.mode === "hotseat" ? "Hot-seat game" : rec.mode === "tutorial" ? "Tutorial" : "Game vs AI"}
      subtitle={<span className="font-mono">seed {rec.seed}</span>}
      hotseat={rec.mode === "hotseat"}
      exitHref="/"
      endActions={
        <>
          <Link href={`/replays/${rec.id}` as Route} className={`${btn} hover:bg-muted`}>
            Watch replay
          </Link>
          <button type="button" className={`${btn} border border-border bg-card hover:bg-muted`} onClick={() => again(true)}>
            Rematch (same seed)
          </button>
          <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={() => again(false)}>
            New game
          </button>
        </>
      }
    />
  );
}
