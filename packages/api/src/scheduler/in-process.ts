// In-process scheduler for tests and local dev. Same contract as Vercel Queues: delayed, at-least-once,
// idempotency keys. With `auto: true` it fires jobs with timers; otherwise tests drive it with `runDue()`.
import type { EnqueueOptions, JobHandlers, JobPayloads, Scheduler, Topic } from "./types";

interface Pending {
  id: number;
  topic: Topic;
  payload: unknown;
  dueAt: number;
  deliveryCount: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class InProcessScheduler implements Scheduler {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private seenKeys = new Set<string>();
  private handlers: JobHandlers | null = null;
  /** Every job ever enqueued (handy for assertions). */
  readonly log: { topic: Topic; payload: unknown; delaySeconds: number }[] = [];

  constructor(
    private readonly opts: { auto?: boolean; now?: () => number; retryAfterSeconds?: number } = {},
  ) {}

  setHandlers(h: JobHandlers) {
    this.handlers = h;
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async enqueue<T extends Topic>(topic: T, payload: JobPayloads[T], opts: EnqueueOptions = {}) {
    if (opts.idempotencyKey) {
      if (this.seenKeys.has(opts.idempotencyKey)) return;
      this.seenKeys.add(opts.idempotencyKey);
    }
    const delaySeconds = Math.max(0, opts.delaySeconds ?? 0);
    this.log.push({ topic, payload, delaySeconds });
    const p: Pending = { id: ++this.seq, topic, payload, dueAt: this.now() + delaySeconds * 1000, deliveryCount: 0 };
    this.pending.set(p.id, p);
    if (this.opts.auto) this.arm(p);
  }

  private arm(p: Pending) {
    p.timer = setTimeout(() => void this.deliver(p), Math.max(0, p.dueAt - this.now()));
  }

  private async deliver(p: Pending) {
    if (!this.handlers) throw new Error("InProcessScheduler: no handlers registered");
    this.pending.delete(p.id);
    p.deliveryCount++;
    try {
      const h = this.handlers[p.topic] as (payload: unknown, meta: { deliveryCount: number }) => Promise<void>;
      await h(p.payload, { deliveryCount: p.deliveryCount });
    } catch (err) {
      // At-least-once: put it back like a failed queue delivery.
      console.error(`[scheduler] ${p.topic} failed (delivery ${p.deliveryCount})`, err);
      p.dueAt = this.now() + (this.opts.retryAfterSeconds ?? 5) * 1000;
      this.pending.set(p.id, p);
      if (this.opts.auto) this.arm(p);
    }
  }

  /** Deliver every job due at `now()` (repeat until nothing new is due). Returns the number delivered. */
  async runDue(filter?: Topic): Promise<number> {
    let n = 0;
    for (;;) {
      const due = [...this.pending.values()]
        .filter((p) => p.dueAt <= this.now() && (!filter || p.topic === filter))
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
      if (due.length === 0) return n;
      for (const p of due) {
        await this.deliver(p);
        n++;
      }
    }
  }

  pendingJobs() {
    return [...this.pending.values()].map(({ topic, payload, dueAt }) => ({ topic, payload, dueAt }));
  }

  clear() {
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    this.seenKeys.clear();
    this.log.length = 0;
  }
}
