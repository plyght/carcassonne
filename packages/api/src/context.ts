import type { Session } from "@carcassonne/auth";
import type { Database } from "@carcassonne/db";

import type { Deps } from "./deps";
import type { Identity } from "./identity";

export type Context = {
  session: Session | null;
  db: Database;
  /** Account user, or a guest holding a valid guest token, or null (anonymous / spectator). */
  identity: Identity | null;
  deps: Deps;
  isAdmin: boolean;
};
