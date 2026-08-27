import type { Facts, JurisdictionQuery } from "@ariane/core";

/**
 * The voice layer's own ontology.
 *
 * Nothing here describes government. Government is `@ariane/core`'s ontology
 * and this package never adds to it, never edits it and never invents a second
 * copy of it. What lives here is the citizen's side of a phone call: who we
 * think they are, how sure we are, what they are allowed to reach, and how much
 * of it they have used up.
 *
 * The one rule the whole package exists to hold:
 *
 *   MODEL UNDERSTANDS. ARIANE DECIDES. POLICY AUTHORIZES. SOURCE PROVES.
 *
 * The model is a speech interface. It is never a security boundary, so nothing
 * in this file is decided by anything the model said.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * How sure we are that the person speaking is the person whose data we hold.
 *
 * Ordered, and the order is load bearing: `atLeast` compares by index, so
 * inserting a level in the middle changes what every policy rule means. Add to
 * the end or change the policy table deliberately.
 *
 * ANONYMOUS   Nobody. Public government information only, which is most of it.
 * RECOGNIZED  This number has called before. Enough to greet them in the right
 *             language, not enough to tell them anything about themselves.
 * VERIFIED    They proved it this call, out of band. Saved journeys unlock here.
 */
export const IDENTITY_LEVELS = ["ANONYMOUS", "RECOGNIZED", "VERIFIED"] as const;
export type IdentityLevel = (typeof IDENTITY_LEVELS)[number];

/** True when `level` is at or above `required`. The only ordering comparison. */
export function atLeast(level: IdentityLevel, required: IdentityLevel): boolean {
  return IDENTITY_LEVELS.indexOf(level) >= IDENTITY_LEVELS.indexOf(required);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type VoiceProvider = "BROWSER" | "VAPI";

export type SessionStatus = "ACTIVE" | "ENDED" | "REVOKED";

/**
 * What a caller has spent. Every field is a ceiling somewhere in `policy.ts`,
 * counted server side and never sent to the model, because a number the model
 * can read is a number a caller can talk it into changing.
 */
export interface SessionBudget {
  toolCalls: number;
  invalidToolCalls: number;
  consecutiveFailures: number;
  turns: number;
}

/**
 * The journey in progress, held on the session.
 *
 * Answers live here first and reach Postgres only for a VERIFIED caller who
 * consented. An anonymous caller gets a working journey that evaporates when
 * they hang up, which is the correct amount of memory for someone we cannot
 * identify.
 */
export interface ActiveJourney {
  id: string;
  serviceId: string;
  /** Answers to derived questions, keyed by the field the graph asked for. */
  answers: Facts;
  /** Canonical document node ids the caller says they hold. */
  documents: string[];
  updatedAt: number;
}

/**
 * A life event in progress: several services at once.
 *
 * The goals, not the compiled plan. Same reason `ActiveJourney` holds answers
 * and not a `CompiledJourney`: the graph is the truth and it may have changed
 * between two turns of the same call, so every turn recompiles from ids.
 */
export interface ActivePlan {
  /** What they said, kept for the heading. Never stored beyond the session. */
  intent: string;
  goals: string[];
  updatedAt: number;
}

/**
 * What this caller's time is worth. Decided by the server from a login, never
 * from anything the caller or the model says. `policy.ts` turns it into a
 * number of milliseconds and nothing else may.
 */
export type Tier = "GUEST" | "AUTHENTICATED";

export interface VoiceSession {
  id: string;
  provider: VoiceProvider;
  tier: Tier;
  /**
   * The Supabase auth user, when somebody signed in. Same rule as `citizenId`:
   * resolved from a cookie the server verified, invisible to the model.
   */
  authUserId?: string;
  /** The provider's own call id. Bound at creation, checked on every webhook. */
  providerCallId?: string;
  /**
   * Resolved server side from the session, never from a tool argument. This is
   * the field §9 exists to protect: the model cannot read it, name it or
   * change it.
   */
  citizenId?: string;
  /**
   * The keyed hash of the calling number, when there was one. Never the number.
   *
   * Present on anonymous sessions too, because the per-caller budget in §17 has
   * to bind to something and the alternative is that hanging up and redialling
   * resets every ceiling in the file.
   */
  callerHash?: string;
  identityLevel: IdentityLevel;
  /** Deny by default. A tool absent from this list does not exist for this call. */
  allowedTools: string[];
  activeJourney?: ActiveJourney;
  /** The life event, when they asked for one. Independent of the journey. */
  activePlan?: ActivePlan;
  jurisdiction: JurisdictionQuery;
  /** BCP 47-ish tag the caller prefers. Presentation only, never authorization. */
  language?: string;
  /** SHA-256 of the bearer token handed to the client. The token itself is never stored. */
  tokenHash: string;
  startedAt: number;
  expiresAt: number;
  status: SessionStatus;
  budget: SessionBudget;
  /**
   * Why a session was downgraded, if it was. Kept so the transcript of what
   * happened is on the session and not only in a log line.
   */
  downgradeReason?: string;
}

/** What the caller's client is handed. The only secret that leaves the server. */
export interface IssuedSession {
  sessionId: string;
  token: string;
  expiresAt: number;
  /** So the UI can say "one minute free" honestly. Display only. */
  tier: Tier;
  identityLevel: IdentityLevel;
  allowedTools: string[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Every tool the model may ever propose. There is no dynamic registration and
 * no passthrough: a name not in this union cannot reach the broker.
 */
export const VOICE_TOOLS = [
  "resolve_need",
  "build_plan",
  "start_journey",
  "answer_question",
  "get_current_journey",
  "explain_step",
  "save_preference",
  "forget_my_data",
  "resume_journey",
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number];

export interface ToolCall {
  /** The provider's id for this call, echoed back so the model can match it. */
  callId: string;
  name: string;
  /** Raw, unparsed, untrusted. A string because that is what providers send. */
  arguments: unknown;
}

/**
 * Why a tool call was refused. Deterministic values, because the guardrail
 * tests assert on them and because a caller should never be able to tell two
 * refusals apart by their wording.
 */
export type RefusalCode =
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "SESSION_ENDED"
  | "UNKNOWN_TOOL"
  | "TOOL_NOT_ALLOWED"
  | "IDENTITY_REQUIRED"
  | "INVALID_ARGUMENTS"
  | "PAYLOAD_TOO_LARGE"
  | "BUDGET_EXCEEDED"
  | "RATE_LIMITED"
  | "NO_ACTIVE_JOURNEY"
  | "NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE"
  | "GUARDRAIL"
  | "TIMEOUT";

/**
 * What the broker gives back. `ok: false` still carries something safe to say
 * out loud, because a refusal the model cannot verbalise turns into the model
 * improvising, which is the failure this whole package is built to prevent.
 */
export type ToolResult =
  | { ok: true; data: unknown; grounding: SpeakableFact[] }
  | { ok: false; code: RefusalCode; speak: string };

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

/**
 * One government claim the model is permitted to say out loud, and the source
 * that proves it.
 *
 * This is §14 in a type. The model may rephrase `text` to sound like a person.
 * It may not add a fee, an office, a portal or a deadline that is not in one of
 * these, and `guardrails.ts` checks the transcript against exactly this set.
 */
export interface SpeakableFact {
  claimId: string;
  text: string;
  /** Absent only for facts about the caller's own session, which cite nothing. */
  sourceId?: string;
  /** True when no person has read the page this came from. The model must say so. */
  machineExtracted?: boolean;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type VoiceEventName =
  | "voice.session.start"
  | "voice.session.end"
  | "voice.turn"
  | "voice.tool.call"
  | "voice.tool.success"
  | "voice.tool.failure"
  | "voice.guardrail"
  | "voice.identity.upgrade"
  | "voice.journey.start"
  | "voice.journey.resume"
  | "voice.journey.complete";

export interface VoiceEvent {
  name: VoiceEventName;
  at: number;
  sessionId: string;
  /** Hashed, never the phone number and never a database primary key. */
  callerHash?: string;
  /** Free-form, but `telemetry.ts` masks it before anything sees it. */
  detail?: Record<string, unknown>;
}
