// Vercel Queues consumer for topic "clock-timeout" (trigger in vercel.json; private, no public URL).
import { handleClockTimeout } from "@carcassonne/api/jobs/handlers";

import { queueConsumer } from "../../src/consumer";

export const POST = queueConsumer("clock-timeout", (s, p) => handleClockTimeout(s.deps, p));
