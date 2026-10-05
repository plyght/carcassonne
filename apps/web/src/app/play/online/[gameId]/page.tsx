"use client";

import { useEffect, useState } from "react";

import { useParams } from "next/navigation";

import { OnlineClient, tileCatalog } from "@carcassonne/game-client";

import { GameScreen } from "@/components/game/game-screen";
import { gameSocketUrl, SERVER_URL } from "@/lib/rooms-api";

export default function OnlineGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [client, setClient] = useState<OnlineClient | null>(null);

  useEffect(() => {
    const c = new OnlineClient({ gameId, wsUrl: gameSocketUrl(), httpBase: SERVER_URL, catalog: tileCatalog });
    setClient(c);
    c.start();
    // Hidden tabs disconnect after 60 s and resume on focus (PRD §7.3) — handled by
    // the server timing us out; the client reconnects with hello{lastPly}.
    return () => c.dispose();
  }, [gameId]);

  if (!client) return null;
  return <GameScreen client={client} title="Online game" subtitle={<span className="font-mono">{gameId}</span>} exitHref="/online" />;
}
