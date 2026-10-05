// Vercel Queues consumer for topic "matchmaking-retry" (trigger in vercel.json; private, no public URL).
import { handleMatchmakingRetry } from "@carcassonne/api/jobs/handlers";

import { queueConsumer } from "../../src/consumer";

export const POST = queueConsumer("matchmaking-retry", (s, p) => handleMatchmakingRetry(s.deps, p));
