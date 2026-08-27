import { VOICE_TOOLS, atLeast, type IdentityLevel, type Tier, type VoiceToolName } from "./types";

/**
 * Deny by default, in one table.
 *
 * Policy is a lookup, never a judgement. Nothing in this file asks a model
 * anything, and nothing in it reads a value the caller supplied. That is the
 * point: an access decision made by a classifier is an access decision an
 * attacker can argue with.
 *
 * If you are adding a tool and it does not appear here, it is denied. That is
 * not a bug to work around.
 */

export interface ToolRule {
  /** The lowest identity level that may call it at all. */
  minIdentity: IdentityLevel;
  /** True when it changes stored state. Used by the read-only downgrade. */
  writes: boolean;
  /** What the caller hears when their level is too low. Never mentions why. */
  refusal: string;
}

export const TOOL_POLICY: Record<VoiceToolName, ToolRule> = {
  // Public government information. This is most of Ariane and it is open to
  // everyone, because it is published and because making a citizen prove who
  // they are to read a fee is the behaviour this product exists against.
  resolve_need: { minIdentity: "ANONYMOUS", writes: false, refusal: "I could not look that up just now." },
  start_journey: { minIdentity: "ANONYMOUS", writes: false, refusal: "I could not open that one just now." },
  get_current_journey: { minIdentity: "ANONYMOUS", writes: false, refusal: "I do not have a journey open." },
  explain_step: { minIdentity: "ANONYMOUS", writes: false, refusal: "I do not have that step open." },

  /**
   * Answering a question is a write to the *session*, not to the database, so
   * it is open. An anonymous caller gets a journey that shortens as they talk
   * and evaporates when they hang up, which is the right amount of memory for
   * someone we cannot identify.
   */
  answer_question: { minIdentity: "ANONYMOUS", writes: false, refusal: "I could not record that answer." },

  /**
   * The first thing that touches Postgres, so the first thing that needs a
   * caller we have actually recognised. Still not sensitive: a language and a
   * district, from a fixed enum, at sixty characters.
   */
  save_preference: {
    minIdentity: "RECOGNIZED",
    writes: true,
    refusal: "I will keep that for this call, but I cannot save it for next time yet.",
  },

  /**
   * Deleting your own data needs to be at least as easy as creating it, and no
   * easier: at ANONYMOUS there is no `citizenId` to delete, so it would either
   * do nothing or delete somebody. RECOGNIZED is the floor where the target is
   * unambiguous, and the store still scopes the delete to that one id.
   */
  forget_my_data: {
    minIdentity: "RECOGNIZED",
    writes: true,
    refusal: "I do not have anything saved about you to remove.",
  },

  /**
   * §10, the whole of it. A phone number tells us who is probably calling. It
   * does not tell us who is holding the phone, and a saved journey can contain
   * that somebody's father died and which certificate they are chasing about
   * it. Caller ID is not authentication and this is the line where that stops
   * being a slogan.
   */
  resume_journey: {
    minIdentity: "VERIFIED",
    writes: false,
    refusal: "Before I bring up anything saved, I need to check it is really you.",
  },
};

/**
 * Names that must never become tools, asserted rather than assumed.
 *
 * §7's list, kept as data so `policy.test.ts` can fail the build the day
 * somebody adds a convenient little `fetch_url` for debugging. A jailbreak
 * should have almost nothing useful to attack, and that is a property of the
 * tool list, not of the prompt.
 */
export const FORBIDDEN_TOOL_NAMES = [
  "execute_sql", "query_database", "fetch_url", "http_request", "browse_web", "shell",
  "filesystem", "run_code", "send_arbitrary_email", "send_arbitrary_sms", "read_user",
  "list_users", "search_users", "update_graph", "write_graph", "raw_supabase",
  "raw_source_fetch", "remember", "eval", "exec",
] as const;

/** The tools a session at this level may see. Order is stable for the prompt. */
export function toolsFor(level: IdentityLevel): VoiceToolName[] {
  return VOICE_TOOLS.filter((name) => atLeast(level, TOOL_POLICY[name].minIdentity));
}

/** The read-only set, for a session downgraded after something went wrong. §16. */
export function readOnlyToolsFor(level: IdentityLevel): VoiceToolName[] {
  return toolsFor(level).filter((name) => !TOOL_POLICY[name].writes);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * §17. Every ceiling in one object so there is one place to read what a call
 * can cost, and so a test can assert the ceilings exist rather than trusting a
 * scattering of magic numbers.
 *
 * None of these are reachable by anything the caller says. There is no tool to
 * raise them and no prompt that mentions them, so "ignore your limits" has
 * nothing to act on: the counter is incremented in `broker.ts` before the tool
 * runs and compared here.
 */
export const LIMITS = {
  /** A government question is answered in minutes or it is not being answered. */
  maxCallMs: 10 * 60_000,
  /** Hard stop on the session record regardless of activity. */
  maxSessionLifetimeMs: 30 * 60_000,
  /** Model turns. A loop that never calls a tool still costs audio minutes. */
  maxTurns: 120,
  /** Successful or not, every proposed tool call counts. */
  maxToolCalls: 60,
  /** Parse failures and denials. A caller probing the surface hits this first. */
  maxInvalidToolCalls: 10,
  /** Consecutive upstream failures before the session stops trying. */
  maxConsecutiveFailures: 4,
  /** One person, one conversation. Ten parallel calls is not a citizen. */
  maxConcurrentSessionsPerCaller: 2,
  /** Per caller per day, in milliseconds of call time. */
  dailyCallerMs: 30 * 60_000,
  /** Everyone, per day. The bill has a ceiling even if the abuse is distributed. */
  dailyGlobalMs: 24 * 60 * 60_000,
  /** A single Ariane call. The compiler is in-process and fast; this is a fuse. */
  toolTimeoutMs: 8_000,
  /** Bytes of tool arguments. Beyond this it is not a question, it is a payload. */
  maxArgumentBytes: 4_096,
  /** Identical tool calls in a row before we call it a loop. */
  maxRepeatsOfSameCall: 3,
} as const;

export type Limits = typeof LIMITS;

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * What you get without logging in, and what you get after.
 *
 * A minute is enough to hear Ariane answer a real question and decide whether
 * it is worth an email address. Ten is enough to finish a journey. The gap is
 * the product argument; the reason it is *here* is the security one.
 *
 * `maxCallMs` is a constant in a table, so there is no code path that takes a
 * duration from a request, a cookie, a tool argument or a model turn. "Set my
 * remaining time to an hour" has nothing to write to. The number is read in
 * three independent places — the session's `expiresAt`, the capacity lease TTL,
 * and the realtime provider's own `maxDurationSeconds` — and the caller would
 * have to defeat all three, on a server they do not control, to gain a second.
 */
export type { Tier };

export const TIERS = {
  GUEST: {
    /** Hard stop. Not extendable, not refreshable, not negotiable. */
    maxCallMs: 60_000,
    /** And that is the whole day's allowance, per cookie and per address. */
    dailyMs: 60_000,
    /** Window the daily allowance resets over. */
    dailyWindowSeconds: 24 * 60 * 60,
  },
  AUTHENTICATED: {
    maxCallMs: 10 * 60_000,
    dailyMs: 30 * 60_000,
    dailyWindowSeconds: 24 * 60 * 60,
  },
} as const satisfies Record<Tier, { maxCallMs: number; dailyMs: number; dailyWindowSeconds: number }>;

/**
 * Seconds remaining at which the caller is warned, longest first.
 *
 * Spoken by the client from the server's `expiresAt`, so a warning that fails
 * to fire is a worse experience and not a longer call — the hard stop is
 * elsewhere and does not consult this.
 */
export const WARN_AT_MS = [30_000, 10_000] as const;

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Ten lines, globally.
 *
 * Global is the operative word. This is a count of rows in Postgres, not a
 * variable in a Node process, because Vercel runs however many instances it
 * feels like and a per-instance counter of ten is a bill for ten times ten.
 */
export const CAPACITY = {
  /** Concurrent realtime sessions across the entire deployment. */
  maxConcurrentCalls: 10,
  /**
   * How long a lease survives without a heartbeat. Three missed beats.
   *
   * This is what makes a closed laptop give its slot back. Shorter and a slow
   * network drops live callers; longer and a crashed tab holds a line for
   * minutes.
   */
  leaseTtlMs: 45_000,
  heartbeatMs: 15_000,
  /** A queue ticket that stops polling for this long is gone. */
  queueTtlMs: 60_000,
  queuePollMs: 2_000,
  /** How long a promoted caller has to actually start their call. */
  claimMs: 30_000,
  /** For "about four minutes" in the queue UI. A guess, and labelled as one. */
  typicalCallMs: 4 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/**
 * Fixed windows, per subject, enforced in Postgres.
 *
 * Nothing here limits reading Ariane. Search, journeys, services, the graph and
 * the map are the product and they stay open; every bucket below guards
 * something that either costs money per call or is a credential guess.
 */
export const RATE_LIMITS = {
  /** Starting a voice session. Generous — retries after a dropped call are normal. */
  voiceSession: { windowSeconds: 60, max: 6 },
  /** Joining the queue. Stops a script from farming ticket positions. */
  voiceQueue: { windowSeconds: 60, max: 20 },
  /** Tool calls from one session. The broker's own budget is the real ceiling. */
  voiceTool: { windowSeconds: 60, max: 90 },
  /** Transcript posts. One per turn plus slack. */
  voiceTurn: { windowSeconds: 60, max: 120 },
  /** The paid intent chain, which is the one unauthenticated route that bills. */
  intent: { windowSeconds: 60, max: 20 },
  /** Magic links. Deliberately mean: each one is an email to somebody's inbox. */
  magicLink: { windowSeconds: 15 * 60, max: 3 },
  /** Admin login attempts per address before the cooldown. §11. */
  adminLogin: { windowSeconds: 15 * 60, max: 5 },
  /** Analytics beacons. Enough for a busy session, not enough to be a firehose. */
  appEvent: { windowSeconds: 60, max: 120 },
} as const;

/** How long a failed-admin-login cooldown lasts once the limit is hit. */
export const ADMIN_LOCKOUT_MS = 15 * 60_000;

/**
 * Repeated HIGH-severity security events buy a rest.
 *
 * Server policy, applied to a count of rows. The classifier's job ends at
 * writing the row; it never decides that somebody is banned, because a
 * classifier that can ban is a classifier worth arguing with.
 */
export const SECURITY_COOLDOWN = {
  windowMs: 60 * 60_000,
  /** HIGH events in that window before voice is closed to this subject. */
  threshold: 3,
  durationMs: 60 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** §17. The numbers `ariane_cleanup` is called with. One place to change them. */
export const RETENTION_DAYS = {
  transcripts: 30,
  securityEvents: 90,
  appEvents: 365,
  ephemeral: 7,
} as const;
