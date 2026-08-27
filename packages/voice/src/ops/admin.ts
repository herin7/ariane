import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The cryptography behind the admin panel, with no framework anywhere near it.
 *
 * §11. Password hashing and cookie signing are the two things in this feature
 * that are worth getting exactly right, so they live here as pure functions
 * over strings — testable without a request, a cookie jar or a running Next.
 * The web app's `app/admin/session.ts` is the thin part: it reads the
 * environment and the jar and calls these.
 */

/** About a working day, so an operator is not signed out mid-incident. */
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** scrypt's cost. 16k/8/1 is roughly 100ms here, which is the point. */
const N = 16_384;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;

/**
 * `scrypt$N$r$p$salt$hash`, all base64url.
 *
 * scrypt because it is memory-hard and because `node:crypto` already has it —
 * argon2 would mean a native module that has to build on Vercel, for a
 * difference nobody attacking a two-operator panel will ever notice.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant time. False rather than throwing on anything malformed. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt = "", expected = ""] = parts;

  const cost = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM };
  // A hash that claims an absurd cost is a denial of service, not a login.
  if (!(cost.N > 0 && cost.N <= 1 << 20) || !(cost.r > 0 && cost.r <= 32) || !(cost.p > 0 && cost.p <= 16)) return false;

  try {
    const want = Buffer.from(expected, "base64url");
    if (want.length < 16) return false;
    const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length, cost);
    return timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

/** Constant-time string comparison that does not leak on a length mismatch. */
export function sameString(a: string, b: string): boolean {
  // Hash first: `timingSafeEqual` throws on differing lengths, and the digests
  // are always the same length whatever went in.
  const key = randomBytes(16);
  return timingSafeEqual(
    createHmac("sha256", key).update(a).digest(),
    createHmac("sha256", key).update(b).digest(),
  );
}

/**
 * An admin session cookie: `<payload>.<signature>` over `<username>:<expiry>`.
 *
 * Not a token that grants anything — it is a claim, and `openAdminSession`
 * re-checks both the signature and the username on every request. Rotating
 * `ADMIN_SESSION_SECRET` invalidates every cookie ever issued.
 */
export function issueAdminSession(username: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(`${username}:${now + ADMIN_SESSION_TTL_MS}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The username in a valid, unexpired, correctly-signed cookie. */
export function openAdminSession(value: string | undefined, secret: string, now = Date.now()): string | undefined {
  if (!value || !secret) return undefined;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return undefined;
  if (!sameString(sign(payload, secret), signature)) return undefined;

  const [username, expiry] = Buffer.from(payload, "base64url").toString().split(":");
  if (!username || !expiry || !Number.isFinite(Number(expiry)) || Number(expiry) <= now) return undefined;
  return username;
}

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");
