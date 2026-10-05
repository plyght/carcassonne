"use client";

import { useState } from "react";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2, Swords } from "lucide-react";

import { DEFAULT_RULESET, type Ruleset } from "@carcassonne/protocol";
import { randomSeedString } from "@carcassonne/game-client";
import { cn } from "@carcassonne/ui/lib/utils";

import { RulesForm } from "@/components/setup/rules-form";
import { roomApi } from "@/lib/rooms-api";

export default function OnlinePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(4);
  const [bots, setBots] = useState(0);
  const [ruleset, setRuleset] = useState<Ruleset>({ ...DEFAULT_RULESET });
  const [seed, setSeed] = useState(() => randomSeedString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await roomApi.create({
        ruleset,
        seats,
        seed,
        bots: Array.from({ length: bots }, (_, i) => ({ seat: seats - 1 - i, tier: "medium" as const })),
      });
      router.push(`/r/${room.code}` as Route);
    } catch (e) {
      setError(`Couldn’t create a room: ${(e as Error).message || "server unavailable"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_1.3fr]">
      <section className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-sm">
        <h1 className="font-display text-3xl">Join a room</h1>
        <p className="mt-1 text-sm text-muted-foreground">Got an invite code? Guests can join with a nickname.</p>
        <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) router.push(`/r/${encodeURIComponent(c)}` as Route);
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. ABBEY7"
            className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-4 font-mono text-lg tracking-widest uppercase"
            aria-label="Room code"
          />
          <button type="submit" className="rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
            Join
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card/80 p-6 shadow-sm">
        <h2 className="font-display text-3xl">Host a room</h2>
        <p className="mt-1 text-sm text-muted-foreground">You set the rules and bots, then share the link.</p>
        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seats</div>
            <div className="inline-flex rounded-xl bg-muted p-0.5">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setSeats(n);
                    setBots((b) => Math.min(b, n - 1));
                  }}
                  className={cn("rounded-lg px-3 py-1 text-sm font-semibold", seats === n ? "bg-card shadow-sm" : "text-muted-foreground")}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bots</div>
            <div className="inline-flex rounded-xl bg-muted p-0.5">
              {Array.from({ length: seats }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBots(n)}
                  className={cn("rounded-lg px-3 py-1 text-sm font-semibold", bots === n ? "bg-card shadow-sm" : "text-muted-foreground")}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <RulesForm ruleset={ruleset} onRuleset={setRuleset} seed={seed} onSeed={setSeed} />
        </div>
        {error ? (
          <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />} Create room
        </button>
      </section>
    </div>
  );
}
