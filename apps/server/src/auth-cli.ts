// Entry for the better-auth CLI (`bun run auth:generate`), which needs a module exporting `auth`.
import { getServices } from "./bootstrap";

export const auth = getServices().auth;
