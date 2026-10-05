// Vercel Queues scheduler (https://vercel.com/docs/queues/sdk). `send(topic, payload, {delaySeconds,
// idempotencyKey})` publishes; the consumers in apps/server/api/queues/*.ts receive the messages through
// `handleCallback` and are wired to topics with `experimentalTriggers` in vercel.json.
import { send } from "@vercel/queue";

import type { EnqueueOptions, JobPayloads, Scheduler, Topic } from "./types";

/** Max delay is 7 days and must not exceed the retention (default 24 h). */
const MAX_DELAY = 24 * 60 * 60 - 60;

export class VercelQueueScheduler implements Scheduler {
  async enqueue<T extends Topic>(topic: T, payload: JobPayloads[T], opts: EnqueueOptions = {}) {
    const delaySeconds = Math.min(MAX_DELAY, Math.max(0, Math.ceil(opts.delaySeconds ?? 0)));
    await send(topic, payload, {
      ...(delaySeconds > 0 ? { delaySeconds } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }
}
