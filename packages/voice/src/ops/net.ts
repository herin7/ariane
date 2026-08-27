import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Who is asking, without writing down who is asking.
 *
 * Two jobs, both about identifying a stranger well enough to rate limit them
 * and no better than that: turning a request into an opaque IP hash, and giving
 * an un-logged-in browser a cookie it cannot forge.
 *
 * Nothing here decides anything. It answers "which bucket does this request
 * count against"; `capacity.ts` and `security.ts` decide what that means.
 */

// ---------------------------------------------------------------------------
// The client's address
// ---------------------------------------------------------------------------

/**
 * The one place a client IP is read, and it is deliberately paranoid.
 *
 * `x-forwarded-for` is a request header, which means it is a string the client
 * types. Trusting it turns every per-IP limit in this system into an honour
 * system: one line of curl and an attacker is a fresh visitor on every request.
 *
 * So the default is to trust only headers Vercel's proxy sets itself and strips
 * from anything inbound — `x-vercel-forwarded-for` first, then `x-real-ip`.
 * `x-forwarded-for` is read only when `ARIANE_TRUST_FORWARDED=1`, which exists
 * for running behind your own nginx in a dev box and has no business being set
 * in production.
 *
 * Returns undefined rather than a placeholder when there is no trustworthy
 * address. Callers must treat that as "cannot identify" and fall back to the
 * cookie subject; inventing `"unknown"` would put every anonymous request into
 * one shared bucket and let one abuser rate limit the world.
 */
export function clientIp(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const vercel = first(headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const real = first(headers.get("x-real-ip"));
  if (real) return real;

  if (env.ARIANE_TRUST_FORWARDED === "1") return first(headers.get("x-forwarded-for"));
  return undefined;
}

/**
 * The leftmost entry of a comma list, normalised.
 *
 * IPv6 is truncated to its /64 prefix. A single residential IPv6 allocation is
 * routinely a /64 or wider, so per-address limiting on v6 is per-*device* and
 * an abuser has 18 quintillion of them. The /64 is the unit that actually costs
 * something to acquire.
 */
function first(header: string | null): string | undefined {
  if (!header) return undefined;
  const raw = header.split(",")[0]?.trim();
  if (!raw) return undefined;

  const ip = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.replace(/:\d+$/, "");
  if (!ip) return undefined;

  if (ip.includes(":")) {
    const groups = ip.split(":");
    // Not expanding `::` — a short form still yields a stable string, and a
    // stable string is all a bucket key needs.
    return groups.length > 4 ? `${groups.slice(0, 4).join(":")}::/64` : ip;
  }
  return ip;
}

/**
 * The only form of an address anything else may hold.
 *
 * Same argument as `hashPhone` next door, and the same shape: keyed, because
 * the entire IPv4 space is four billion entries and a plain digest of it is a
 * rainbow table somebody has already built. The key lives in the environment,
 * so these tables full of `ip_hash` are not a visitor log if the database
 * leaks.
 */
export function hashIp(ip: string, secret: string): string {
  if (!secret) throw new Error("RATE_LIMIT_SECRET is required to hash a client address");
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/** `clientIp` then `hashIp`, or undefined when the address was not trustworthy. */
export function ipHash(
  headers: Headers,
  secret: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const ip = clientIp(headers, env);
  return ip ? hashIp(ip, secret) : undefined;
}

// ---------------------------------------------------------------------------
// The guest cookie
// ---------------------------------------------------------------------------

export const GUEST_COOKIE = "ariane_guest";

/**
 * Long enough to outlive the 24h quota window it protects, so that clearing it
 * is a deliberate act rather than something that happens over lunch.
 */
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * An id the browser cannot change without us noticing.
 *
 * Signed, not encrypted: there is nothing secret in a random uuid, we only need
 * to know it came from us. An unsigned cookie would make the guest quota a
 * suggestion — edit one value, get another free minute.
 */
export function issueGuest(secret: string): string {
  const id = randomUUID();
  return `${id}.${sign(id, secret)}`;
}

/** The id inside a guest cookie, or undefined if it was tampered with. */
export function readGuest(value: string | undefined, secret: string): string | undefined {
  if (!value) return undefined;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return undefined;

  const id = value.slice(0, dot);
  const presented = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret));
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return undefined;
  return id;
}

function sign(id: string, secret: string): string {
  if (!secret) throw new Error("RATE_LIMIT_SECRET is required to sign a guest cookie");
  // Domain-separated from `hashIp` so the two uses of one secret cannot be
  // played against each other.
  return createHmac("sha256", secret).update(`guest:${id}`).digest("base64url").slice(0, 32);
}

/**
 * The subjects a guest's free minute is charged against.
 *
 * Both, always, and the stricter wins in `voice_guest_consume`. Clearing
 * cookies changes the first and not the second; a new phone on the same wifi
 * changes the second and not the first. Neither alone is enough to be a new
 * person, which is the point.
 */
export function guestSubjects(input: { guestId?: string; ipHash?: string }): string[] {
  const subjects: string[] = [];
  if (input.guestId) subjects.push(`guest:${input.guestId}`);
  if (input.ipHash) subjects.push(`ip:${input.ipHash}`);
  return subjects;
}

/**
 * A stable, meaningless id for one browser's analytics events.
 *
 * Not signed and not worth signing: forging it corrupts your own funnel row and
 * reaches nothing. It exists so `app_events` can count visitors without needing
 * a login or an address.
 */
export const ANON_COOKIE = "ariane_anon";
export const newAnonId = (): string => randomUUID();
