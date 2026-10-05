import { createAuth } from "@carcassonne/auth";
import { createDb } from "@carcassonne/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
