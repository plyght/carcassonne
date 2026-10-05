// Who is calling: a better-auth user or a guest holding a signed guest token (PRD §6.5: guests may
// join invite rooms with a nickname; ranked needs an account).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Identity =
  | { kind: "user"; userId: string; name: string }
  | { kind: "guest"; guestId: string; name: string };

const GUEST_TTL_MS = 30 * 24 * 3600 * 1000;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(`guest.v1.${body}`).digest();
}

export function newGuestId() {
  return `g_${randomBytes(12).toString("base64url")}`;
}

export function issueGuestToken(secret: string, nickname: string, guestId = newGuestId(), now = Date.now()) {
  const body = b64u(JSON.stringify({ gid: guestId, name: nickname, exp: now + GUEST_TTL_MS }));
  return { token: `${body}.${b64u(sign(secret, body))}`, guestId };
}

export function verifyGuestToken(secret: string, token: string | null | undefined, now = Date.now()) {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(secret, body);
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { gid: string; name: string; exp: number };
    if (typeof p.gid !== "string" || typeof p.name !== "string" || p.exp < now) return null;
    return { kind: "guest", guestId: p.gid, name: p.name } satisfies Identity;
  } catch {
    return null;
  }
}

/** Header carrying the guest token on HTTP requests (WebSocket: `?guest=` query param). */
export const GUEST_HEADER = "x-guest-token";

export function identityKey(i: Identity) {
  return i.kind === "user" ? `u:${i.userId}` : `g:${i.guestId}`;
}

export function sanitizeNickname(n: string) {
  return n.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) || "Guest";
}
