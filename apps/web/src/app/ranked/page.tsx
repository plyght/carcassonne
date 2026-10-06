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
    <div className="carc-page">
      <h1 className="carc-page-title">Ranked</h1>
      <p className="carc-page-lead">Free-for-all with a fixed ruleset and clock. Ratings use Glicko-2; no bots, no takebacks.</p>
      {!isPending && !session ? (
        <div className="carc-notice mt-[var(--sp-6)] flex flex-wrap items-center justify-between gap-[var(--sp-3)]">
          <span>Ranked play needs an account.</span>
          <Link href="/login" className="carc-btn" data-size="compact">
            Sign in or create one
          </Link>
        </div>
      ) : null}
      <div className="mt-[var(--sp-6)] grid gap-[var(--sp-4)] sm:grid-cols-2">
        {(["ffa3", "ffa4"] as const).map((q) => (
          <section key={q} className="carc-sheet flex flex-col">
            <span className="carc-well">
              <Trophy />
            </span>
            <h2 className="carc-heading mt-[var(--sp-4)]">{q === "ffa3" ? "3 players" : "4 players"}</h2>
            <p className="carc-sub">Seat order picked by the server.</p>
            <div className="mt-auto pt-[var(--sp-6)]">
              {queue === q ? (
                <button
                  type="button"
                  onClick={async () => {
                    setQueue(null);
                    try {
                      await matchmakingApi.leave();
                    } catch {}
                  }}
                  className="carc-btn w-full"
                >
                  <Loader2 className="animate-spin" /> Searching… <span className="carc-num">{since}s</span> · Cancel
                </button>
              ) : (
                <button type="button" disabled={!session || !!queue} onClick={() => join(q)} className="carc-btn w-full" data-variant="primary">
                  Find a match
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {error ? (
        <p className="carc-notice mt-[var(--sp-4)]" data-tone="danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
