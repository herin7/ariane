import { VOICE_TOOLS, atLeast, type IdentityLevel, type VoiceToolName } from "./types";

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
