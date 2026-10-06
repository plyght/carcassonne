"use client";

// Audio buses (PRD §6.4: master / music / SFX / ambience). The soundscape and music
// are not in the build yet, so this is the mixing stub the UI is wired to: levels come
// from the settings store, gains are real Web Audio nodes once a sound plays, and the
// only sounds today are tiny synthesized foley ticks (tile rotation detents).

import { useEffect } from "react";

import { useSettings, type VolumeBus, type VolumeLevels } from "./settings";

type Mixer = { ctx: AudioContext; master: GainNode; buses: Record<Exclude<VolumeBus, "master">, GainNode> };

let mixer: Mixer | null = null;
let levels: VolumeLevels = { master: 80, music: 60, sfx: 80, ambience: 50 };

function context(): Mixer | null {
  if (mixer) return mixer;
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    mixer = { ctx, master, buses: { music: bus(), sfx: bus(), ambience: bus() } };
    applyLevels();
    return mixer;
  } catch {
    return null;
  }
}

function applyLevels() {
  if (!mixer) return;
  const t = mixer.ctx.currentTime;
  mixer.master.gain.setTargetAtTime(levels.master / 100, t, 0.02);
  for (const b of ["music", "sfx", "ambience"] as const) mixer.buses[b].gain.setTargetAtTime(levels[b] / 100, t, 0.02);
}

/** Effective linear gain of a bus (master × bus), 0..1. */
export function busGain(bus: Exclude<VolumeBus, "master">): number {
  return (levels.master / 100) * (levels[bus] / 100);
}

export function setAudioLevels(next: VolumeLevels) {
  levels = { ...next };
  applyLevels();
}

/** A short wooden "tock" on the SFX bus. Call from a user gesture (autoplay policy). */
export function playTick(pitch = 1) {
  if (busGain("sfx") <= 0) return;
  const a = context();
  if (!a) return;
  try {
    if (a.ctx.state === "suspended") void a.ctx.resume();
    const t = a.ctx.currentTime;
    const osc = a.ctx.createOscillator();
    const env = a.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.07);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.16, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(env).connect(a.buses.sfx);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* audio is best-effort */
  }
}

/** Keep the mixer in sync with the saved volume levels (mounted by the game screen). */
export function useAudioLevels() {
  const v = useSettings().volume;
  useEffect(() => {
    setAudioLevels(v);
    document.documentElement.dataset.volume = `${v.master},${v.music},${v.sfx},${v.ambience}`;
  }, [v]);
}
