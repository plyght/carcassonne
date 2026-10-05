"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trophy } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { matchmakingApi } from "@/lib/rooms-api";

export default function RankedPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [queue, setQueue] = useState<"ffa3" | "ffa4" | null>(null);
  const [since, setSince] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queue) return;
    const id = setInterval(async () => {
      setSince((s) => s + 1);
      try {
        const st = await matchmakingApi.status();
        if (st.status === "matched" && st.gameId) router.push(`/play/online/${st.gameId}` as Route);
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [queue, router]);

  const join = async (q: "ffa3" | "ffa4") => {
    setError(null);
    try {
      await matchmakingApi.join(q);
      setQueue(q);
      setSince(0);
    } catch (e) {
      setError((e as Error).message || "Matchmaking unavailable");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl tracking-tight">Ranked</h1>
      <p className="mt-1 text-muted-foreground">Free-for-all with a fixed ruleset and clock. Ratings use Glicko-2; no bots, no takebacks.</p>
      {!isPending && !session ? (
        <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5">
          <p>Ranked play needs an account.</p>
          <Link href="/login" className="mt-2 inline-block font-semibold text-primary underline">
            Sign in or create one
          </Link>
        </div>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(["ffa3", "ffa4"] as const).map((q) => (
          <div key={q} className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-sm">
            <Trophy className="mb-2 size-6 text-primary" />
            <h2 className="font-display text-2xl">{q === "ffa3" ? "3 players" : "4 players"}</h2>
            <p className="text-sm text-muted-foreground">Seat order picked by the server.</p>
            {queue === q ? (
              <button
                type="button"
                onClick={async () => {
                  setQueue(null);
                  try {
                    await matchmakingApi.leave();
                  } catch {}
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold"
              >
                <Loader2 className="size-4 animate-spin" /> Searching… {since}s · Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={!session || !!queue}
                onClick={() => join(q)}
                className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Find a match
              </button>
            )}
          </div>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
