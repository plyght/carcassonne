// Plays core/anim timelines. Pure (no three.js): the renderer feeds it time
// deltas from its clock (or a test feeds a fake clock) and reads clip
// progress. Batches queue back to back; each batch can carry a callback that
// runs when it finishes (the renderer reconciles to the final GameView there).
import { EASINGS, type AnimClip, type AnimTimeline } from "@carcassonne/core-geo/anim";

export interface PlayingClip {
  clip: AnimClip;
  /** Batch-unique key: `b<batch>:<clip.key>`. */
  key: string;
  /** Absolute start time on the player clock (seconds). */
  start: number;
  end: number;
  batch: number;
}

export interface ClipSample {
  clip: AnimClip;
  key: string;
  /** Linear 0..1 time fraction. */
  t: number;
  /** Eased progress (may overshoot for back/elastic easings). */
  p: number;
}

export interface TimelineHooks {
  /** Called once when a clip starts (time reached `start`). */
  onStart?(c: PlayingClip): void;
  /** Called once when a clip ends (time reached `end`; also for 0-duration clips). */
  onEnd?(c: PlayingClip): void;
}

interface Batch {
  id: number;
  start: number;
  end: number;
  done?: () => void;
}

/** Easing with an optional overshoot amplification (cartoon squash-and-stretch). */
export function ease(clip: AnimClip, t: number, overshoot = 0): number {
  const p = EASINGS[clip.easing](Math.max(0, Math.min(1, t)));
  if (overshoot <= 0 || clip.easing === "step") return p;
  // amplify the part above 1 (back / elastic easings overshoot further)
  return p > 1 ? 1 + (p - 1) * (1 + overshoot * 2) : p;
}

export class TimelinePlayer {
  /** Current player clock (seconds). */
  time = 0;
  private clips: PlayingClip[] = [];
  private started = new Set<string>();
  private batches: Batch[] = [];
  private nextBatch = 0;

  constructor(private hooks: TimelineHooks = {}) {}

  /** End of everything queued (absolute seconds). */
  get end(): number {
    return this.batches.reduce((m, b) => Math.max(m, b.end), this.time);
  }

  get busy(): boolean {
    return this.batches.length > 0;
  }

  /**
   * Queue a timeline to start when the previous one ends (or now, if idle).
   * `gap` lets consecutive batches overlap (negative) or pause (positive).
   * Returns the batch id.
   */
  enqueue(tl: AnimTimeline, done?: () => void, gap = 0): number {
    const id = this.nextBatch++;
    const start = this.batches.length > 0 ? Math.max(this.time, this.end + gap) : this.time;
    let end = start + tl.duration;
    for (const c of tl.clips) {
      const s = start + c.start;
      const e = s + c.duration;
      end = Math.max(end, e);
      this.clips.push({ clip: c, key: `b${id}:${c.key}`, start: s, end: e, batch: id });
    }
    this.batches.push({ id, start, end, done });
    return id;
  }

  /** Advance the clock by `dt` seconds, firing start/end hooks and batch callbacks in time order. */
  advance(dt: number): void {
    this.seek(this.time + Math.max(0, dt));
  }

  /** Jump to the end of everything queued (e.g. reduced motion, tab hidden, or a resync). */
  finish(): void {
    this.seek(this.end);
  }

  private seek(to: number): void {
    this.time = to;
    // starts, in start order
    const starting = this.clips.filter((c) => !this.started.has(c.key) && c.start <= to).sort((a, b) => a.start - b.start);
    for (const c of starting) {
      this.started.add(c.key);
      this.hooks.onStart?.(c);
    }
    const ending = this.clips.filter((c) => c.end <= to).sort((a, b) => a.end - b.end);
    if (ending.length > 0) {
      const gone = new Set(ending.map((c) => c.key));
      this.clips = this.clips.filter((c) => !gone.has(c.key));
      for (const c of ending) {
        this.started.delete(c.key);
        this.hooks.onEnd?.(c);
      }
    }
    // batches complete in order once all their clips ended and the clock passed their end
    while (this.batches.length > 0) {
      const b = this.batches[0]!;
      if (b.end > to || this.clips.some((c) => c.batch === b.id)) break;
      this.batches.shift();
      b.done?.();
    }
  }

  /** Clips running at the current time, with progress. */
  active(overshoot = 0): ClipSample[] {
    const out: ClipSample[] = [];
    for (const c of this.clips) {
      if (c.start > this.time) continue;
      const t = c.clip.duration <= 0 ? 1 : (this.time - c.start) / c.clip.duration;
      out.push({ clip: c.clip, key: c.key, t: Math.min(1, t), p: ease(c.clip, t, overshoot) });
    }
    return out;
  }

  /** Clips not started yet. */
  pending(): PlayingClip[] {
    return this.clips.filter((c) => c.start > this.time);
  }

  clear(): void {
    this.clips = [];
    this.started.clear();
    const bs = this.batches;
    this.batches = [];
    for (const b of bs) b.done?.();
  }
}

/** A clock the renderer reads each frame; tests inject a manual one. */
export interface Clock {
  /** Seconds since the previous call. */
  delta(): number;
}

export class RealClock implements Clock {
  private last = -1;
  delta(): number {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const d = this.last < 0 ? 0 : (now - this.last) / 1000;
    this.last = now;
    return Math.min(d, 0.1); // clamp long frames (tab switches)
  }
}

export class ManualClock implements Clock {
  private pendingDt = 0;
  tick(seconds: number): void {
    this.pendingDt += seconds;
  }
  delta(): number {
    const d = this.pendingDt;
    this.pendingDt = 0;
    return d;
  }
}
