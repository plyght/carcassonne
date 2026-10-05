import type { Session } from "@carcassonne/auth";
import type { Database } from "@carcassonne/db";

export type Context = {
  session: Session | null;
  db: Database;
};
