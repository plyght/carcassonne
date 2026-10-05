"use client";

import { useEffect, useState } from "react";

import { useParams } from "next/navigation";

import { OnlineClient } from "@carcassonne/game-client";

import { GameScreen } from "@/components/game/game-screen";
import { loadCoreAssets } from "@/lib/core";
import { gameApi, gameSocketUrl, playersOf, SERVER_URL, serverTransport } from "@/lib/rooms-api";

export default function OnlineGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [client, setClient] = useState<OnlineClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let c: OnlineClient | null = null;
    let disposed = false;
    void (async () => {
      try {
        const [core, transport, first] = await Promise.all([loadCoreAssets(), serverTransport(), gameApi.get(gameId)]);
        if (disposed) return;
        c = new OnlineClient({
          gameId,
          wsUrl: gameSocketUrl(),
          httpBase: SERVER_URL,
          catalog: core.catalog,
          rules: core.rules,
          players: playersOf(first),
          forcePolling: transport === "polling",
          snapshot: async () => {
            const g = await gameApi.get(gameId);
            return { view: g.view, seat: g.seat, players: playersOf(g) };
          },
          submitHttp: async (id, ply, move) => {
            await gameApi.submitMove(id, ply, move);
          },
        });
        setClient(c);
        c.start();
      } catch (e) {
        if (!disposed) setError((e as Error).message || "Couldn’t load the game");
      }
    })();
    // Hidden tabs disconnect after 60 s and resume on focus (PRD §7.3): the server times
    // the socket out and the client reconnects with hello{lastPly}.
    return () => {
      disposed = true;
      c?.dispose();
    };
  }, [gameId]);

  if (error) return <div className="grid h-full place-items-center p-6 text-center text-destructive">{error}</div>;
  if (!client) return <div className="h-full bg-[#a4743f]" />;
  return <GameScreen client={client} title="Online game" subtitle={<span className="font-mono">{gameId.slice(0, 8)}</span>} exitHref="/online" />;
}
