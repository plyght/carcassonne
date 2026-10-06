"use client";

import { useState } from "react";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader, Target } from "reicon-react";

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
    <div className="carc-page reveal grid items-start gap-[var(--sp-6)] md:grid-cols-[1fr_1.3fr]" data-width="wide">
      <section className="carc-sheet">
        <h1 className="carc-heading">Join a room</h1>
        <p className="carc-sub">If you have an invite code, you can join here, and guests only need a nickname.</p>
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
            className="carc-field flex-1 font-mono tracking-[0.12em] uppercase placeholder:tracking-normal placeholder:normal-case"
            aria-label="Room code"
          />
          <button type="submit" className="carc-btn" data-variant="primary">
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
          <p className="carc-notice mt-[var(--sp-4)]" data-tone="danger" role="alert">
            {error}
          </p>
        ) : null}
        {!isPending && !session ? (
          <p className="carc-notice mt-[var(--sp-4)]">
            Hosting needs an account.{" "}
            <a href="/login" className="carc-link">
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
          className="carc-btn mt-[var(--sp-6)]"
          data-variant="primary"
          data-size="large"
        >
          {busy ? <Loader className="animate-spin" /> : <Target />} Create room
        </button>
      </section>
    </div>
  );
}
