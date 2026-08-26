import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { RawPhone } from "./schemas";
import type { IdentityLevel } from "./types";

/**
 * Who is calling, and how much that is worth.
 *
 * §10 in one file. A phone number is a hint. It arrives from a telephony
 * provider, it is trivially spoofable by anyone who has ever read about caller
 * ID, and it is the single most tempting thing in this system to treat as a
 * login. So it never leaves this file in a form anything else can use: what
 * the rest of the package sees is an opaque hash, and the hash unlocks
 * RECOGNIZED and nothing above it.
 */

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * To E.164, assuming India when no country code was given.
 *
 * Not a general phone library and not trying to be. Ariane is a Gujarat
 * product, callers dial from Indian numbers, and the failure mode of guessing
 * wrong is that a returning caller is not recognised and gets asked their
 * language again. That is a small enough loss to not take a dependency for.
 *
 * Known limit: +91 is assumed. Swap for libphonenumber if we ever answer a call
 * from outside India.
 */
export function normalisePhone(raw: string): string | undefined {
  if (!RawPhone.safeParse(raw).success) return undefined;

  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return undefined;

  // Already international.
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  // 0091..., 91..., 0..., or a bare ten digit Indian mobile.
  if (digits.startsWith("00")) return normalisePhone(`+${digits.slice(2)}`);
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  return undefined;
}

/**
 * The only form of a phone number anything else is allowed to hold.
 *
 * Keyed, not a bare digest. A plain SHA-256 of a ten digit Indian mobile is
 * reversible in seconds on a laptop: there are only ten billion of them and the
 * first digit is one of four. The key turns the table an attacker would have to
 * build from "one, for everyone" into "one, for this deployment, if they also
 * stole the key", and the key lives in the environment rather than in Postgres
 * so that a database leak is not also a phone book.
 *
 * Truncated to 32 hex characters. 128 bits is far past collision risk at our
 * scale and it keeps the column narrow enough to index and short enough that
 * nobody is tempted to paste one into a log line and call it anonymous.
 */
export function hashPhone(e164: string, secret: string): string {
  if (!secret) throw new Error("VOICE_PHONE_HMAC_SECRET is required to hash a caller id");
  return createHmac("sha256", secret).update(e164).digest("hex").slice(0, 32);
}

/** Normalise then hash, or undefined if it was not a phone number at all. */
export function callerHash(raw: string | undefined, secret: string): string | undefined {
  if (!raw) return undefined;
  const e164 = normalisePhone(raw);
  return e164 ? hashPhone(e164, secret) : undefined;
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

/** 256 bits from the OS. The only secret this package ever hands to a client. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/**
 * Constant time, and false rather than throwing on a length mismatch.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and a throw that
 * happens before any comparison is itself a timing signal. Both sides are
 * fixed-length hex digests here, so a mismatch means a malformed token, but
 * writing it this way keeps that true if the digest ever changes.
 */
export function tokenMatches(presented: string, stored: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newSessionId = (): string => randomUUID();

// ---------------------------------------------------------------------------
// Step up
// ---------------------------------------------------------------------------

/**
 * How a call gets from RECOGNIZED to VERIFIED.
 *
 * An interface with two implementations, which is one more than this codebase
 * usually tolerates, and it earns it: the real one sends an SMS and there is no
 * SMS provider in this repository, so without the stub the VERIFIED path would
 * be untestable and therefore untested. §26 and §27 both need to be able to
 * stand a caller up at VERIFIED and prove they still cannot read anybody else.
 *
 * The model is not part of this. It cannot start a challenge, cannot see a
 * code, cannot submit one, and there is no tool that does any of those. A code
 * that reaches the model is a code in a transcript, and §12 says transcripts do
 * not exist.
 */
export interface StepUpProvider {
  /** Begin a challenge for a caller. Returns an opaque id, never the code. */
  challenge(callerHash: string): Promise<{ challengeId: string; expiresAt: number }>;
  /** Check a code the citizen entered on a keypad or a web page. Never spoken. */
  verify(challengeId: string, code: string): Promise<boolean>;
}

/**
 * The deterministic provider, for tests and for a demo with no SMS account.
 *
 * Refuses to run unless it is told to, twice: `ARIANE_VOICE_STUB_STEPUP=1` and
 * a non-production `NODE_ENV`. A verification provider that always says yes is
 * exactly the thing that gets left switched on.
 */
export function stubStepUp(
  env: Record<string, string | undefined> = process.env,
): StepUpProvider {
  if (env.ARIANE_VOICE_STUB_STEPUP !== "1" || env.NODE_ENV === "production") {
    throw new Error("The stub step-up provider refuses to run outside a test or a local demo");
  }

  const pending = new Map<string, { code: string; expiresAt: number }>();
  return {
    async challenge(caller: string) {
      const challengeId = randomUUID();
      const expiresAt = Date.now() + 5 * 60_000;
      // Derived, not random, so a test can compute it without the provider
      // ever having to hand a code back to its caller.
      pending.set(challengeId, { code: stubCodeFor(caller), expiresAt });
      return { challengeId, expiresAt };
    },
    async verify(challengeId: string, code: string) {
      const found = pending.get(challengeId);
      if (!found || found.expiresAt < Date.now()) return false;
      pending.delete(challengeId);
      return tokenMatches(code, found.code);
    },
  };
}

/** The stub's code for a caller. Test-only, and useless without the same secret. */
export function stubCodeFor(caller: string): string {
  return createHmac("sha256", "ariane-voice-stub").update(caller).digest("hex").slice(0, 6);
}

/**
 * The level a caller starts at.
 *
 * Recognising a returning number is worth something: it is how we greet them in
 * Gujarati without asking again. It is worth exactly that and it stops there.
 */
export function initialIdentityLevel(known: { callerHash?: string; citizenId?: string }): IdentityLevel {
  return known.callerHash && known.citizenId ? "RECOGNIZED" : "ANONYMOUS";
}
