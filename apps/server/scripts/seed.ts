// Dev seed: `bun run db:seed` (from apps/server, after `bun run db:migrate`).
// Creates four password accounts, their profiles, a lobby room with a bot, and a game vs two bots.
import { createGame } from "@carcassonne/api/game/service";
import { roomCode } from "@carcassonne/api/routers/room";
import { profile, room, user } from "@carcassonne/db/schema/index";
import { DEFAULT_RULESET } from "@carcassonne/protocol";
import { eq } from "drizzle-orm";

import { getServices } from "../src/bootstrap";

const PASSWORD = "carcassonne-dev";
const PLAYERS = [
  { email: "ada@dev.local", name: "Ada", color: "red" },
  { email: "brian@dev.local", name: "Brian", color: "blue" },
  { email: "cleo@dev.local", name: "Cleo", color: "green" },
  { email: "dov@dev.local", name: "Dov", color: "yellow" },
] as const;

const services = getServices();
const { db, auth, deps } = services;

const ids: string[] = [];
for (const p of PLAYERS) {
  let [u] = await db.select().from(user).where(eq(user.email, p.email));
  if (!u) {
    await auth.api.signUpEmail({ body: { email: p.email, password: PASSWORD, name: p.name } });
    [u] = await db.select().from(user).where(eq(user.email, p.email));
  }
  ids.push(u!.id);
  await db
    .insert(profile)
    .values({ userId: u!.id, displayName: p.name, colorPref: p.color })
    .onConflictDoNothing();
}

const [lobby] = await db
  .insert(room)
  .values({
    code: roomCode(),
    hostId: ids[0]!,
    ruleset: DEFAULT_RULESET,
    clock: { type: "turn", turnSeconds: 60 },
    seats: [
      { kind: "human", userId: ids[0]!, guestId: null, name: "Ada" },
      { kind: "bot", tier: "medium", name: "Medium Bot" },
    ],
  })
  .returning();

const gameId = await createGame(deps, {
  ruleset: DEFAULT_RULESET,
  clock: { type: "none" },
  seats: [
    { kind: "human", userId: ids[1]!, guestId: null, name: "Brian" },
    { kind: "bot", tier: "easy", name: "Easy Bot" },
    { kind: "bot", tier: "medium", name: "Medium Bot" },
  ],
});

console.log(`Seeded ${PLAYERS.length} accounts (password "${PASSWORD}"): ${PLAYERS.map((p) => p.email).join(", ")}`);
console.log(`Lobby room: /r/${lobby!.code}`);
console.log(`Game vs bots: ${gameId} (Brian to move)`);
await services.close();
process.exit(0);
