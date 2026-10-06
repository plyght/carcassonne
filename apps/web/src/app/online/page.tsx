"use client";

import { useState } from "react";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2, Swords } from "lucide-react";

import { SelectControl, Slider } from "dialkit";

import { DEFAULT_RULESET, type AiTier, type Ruleset } from "@carcassonne/protocol";

import { ClockSettings, type RoomClock } from "@/components/dial/clock-settings";
import { DialField, DialSurface } from "@/components/dial/primitives";
import { TIER_INFO } from "@/components/dial/seat-row";
import { RulesForm } from "@/components/setup/rules-form";
import { authClient } from "@/lib/auth-client";
import { roomApi } from "@/lib/rooms-api";

export default function OnlinePage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(4);
  const [bots, setBots] = useState(0);
  const [botTier, setBotTier] = useState<AiTier>("medium");
  const [ruleset, setRuleset] = useState<Ruleset>({ ...DEFAULT_RULESET });
  const [clock, setClock] = useState<RoomClock>({ type: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await roomApi.create({
        ruleset,
        maxPlayers: seats,
        bots: Array.from({ length: bots }, () => botTier),
        clock,
      });
      router.push(`/r/${room.code}` as Route);
    } catch (e) {
      setError(`Couldn’t create a room: ${(e as Error).message || "server unavailable"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl items-start gap-[var(--sp-6)] px-[var(--sp-4)] py-[var(--sp-8)] md:grid-cols-[1fr_1.3fr]">
      <section className="carc-sheet">
        <h1 className="carc-heading">Join a room</h1>
        <p className="carc-sub">Got an invite code? Guests can join with a nickname.</p>
        <form
          className="mt-[var(--sp-4)] flex gap-[var(--sp-2)]"
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
            className="h-10 min-w-0 flex-1 rounded-[var(--r-control)] bg-[var(--fill)] px-[var(--sp-3)] font-mono text-base tracking-widest uppercase placeholder:text-[var(--text-2)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
            aria-label="Room code"
          />
          <button type="submit" className="h-10 rounded-[var(--r-control)] bg-primary px-[var(--sp-4)] font-semibold text-primary-foreground">
            Join
          </button>
        </form>
      </section>

      <section className="carc-sheet">
        <h2 className="carc-heading">Host a room</h2>
        <p className="carc-sub">You set the rules and bots, then share the link.</p>
        <DialSurface className="carc-dial-stack mt-[var(--sp-4)] gap-[var(--sp-3)]!">
          <DialField hint="Open seats are filled by people with the invite link; bots take the rest.">
            <Slider
              label="Seats"
              value={seats}
              min={2}
              max={5}
              step={1}
              onChange={(v) => {
                const n = Math.round(v);
                setSeats(n);
                setBots((b) => Math.min(b, n - 1));
              }}
            />
          </DialField>
          <Slider label="Bots" value={bots} min={0} max={seats - 1} step={1} onChange={(v) => setBots(Math.round(v))} />
          {bots > 0 ? (
            <DialField hint={TIER_INFO.find((t) => t.id === botTier)?.hint}>
              <SelectControl label="Bot level" value={botTier} options={TIER_INFO.map((t) => ({ value: t.id, label: t.label }))} onChange={(v) => setBotTier(v as AiTier)} />
            </DialField>
          ) : null}
          <div className="carc-dial-section-label">House rules</div>
          <RulesForm ruleset={ruleset} onRuleset={setRuleset} />
          <div className="carc-dial-section-label">Clock</div>
          <ClockSettings value={clock} onChange={setClock} />
        </DialSurface>
        {error ? (
          <p className="mt-[var(--sp-4)] rounded-[var(--r-control)] bg-destructive/10 px-[var(--sp-3)] py-[var(--sp-2)] text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!isPending && !session ? (
          <p className="mt-[var(--sp-4)] text-sm text-pretty text-[var(--text-2)]">
            Hosting needs an account.{" "}
            <a href="/login" className="font-semibold text-primary underline">
              Sign in or sign up
            </a>
            ; guests can join with a code.
          </p>
        ) : null}
        <button
          type="button"
          onClick={create}
          disabled={busy || !session}
          data-testid="create-room"
          className="mt-[var(--sp-4)] inline-flex h-12 items-center gap-[var(--sp-2)] rounded-[var(--r-control)] bg-primary px-[var(--sp-6)] font-semibold text-primary-foreground shadow-[0_10px_22px_-12px_var(--primary)] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />} Create room
        </button>
      </section>
    </div>
  );
}
