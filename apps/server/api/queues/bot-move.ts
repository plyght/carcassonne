// Vercel Queues consumer for topic "bot-move" (trigger in vercel.json; private, no public URL).
import { handleBotMove } from "@carcassonne/api/jobs/handlers";

import { queueConsumer } from "../../src/consumer";

export const POST = queueConsumer("bot-move", (s, p) => handleBotMove(s.deps, p));
