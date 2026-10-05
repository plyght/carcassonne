// Shared wrapper for the Vercel Queues push consumers in api/queues/*.ts
// (https://vercel.com/docs/queues/sdk#consuming-messages-in-push-mode). Handlers are idempotent, so
// at-least-once redelivery is safe; poison messages are acknowledged after a bounded number of tries.
import { handleCallback } from "@vercel/queue";

import type { JobPayloads, Topic } from "@carcassonne/api/scheduler/types";

import { getServices } from "./bootstrap";
import type { Services } from "./services";

export const MAX_DELIVERIES = 8;

export function queueConsumer<T extends Topic>(
  topic: T,
  run: (services: Services, payload: JobPayloads[T]) => Promise<unknown>,
) {
  return handleCallback<JobPayloads[T]>(
    async (payload, meta) => {
      const result = await run(getServices(), payload);
      console.log(`[queue:${topic}] ${meta.messageId} delivery=${meta.deliveryCount}`, result ?? "");
    },
    {
      retry: (_err, meta) => {
        if (meta.deliveryCount >= MAX_DELIVERIES) return { acknowledge: true };
        return { afterSeconds: Math.min(60, 2 ** meta.deliveryCount) };
      },
    },
  );
}
