/**
 * `@ariane/voice` — the voice interface, as an adapter over Ariane.
 *
 * Nothing in this package knows a government fact. It resolves who is calling,
 * decides what they may reach, asks `@ariane/core` the same questions the web
 * app asks it, and cuts the answer down to something a person can hear.
 *
 * Three entry points, and the split is the same one `@ariane/core` makes:
 *
 *   `@ariane/voice`         types, policy, schemas, guardrails. No I/O.
 *   `@ariane/voice/server`  the broker, the store, the transports. Server only.
 *   `@ariane/voice/client`  the browser WebRTC client. No Node, no secrets.
 *
 * Importing the root from a client component is safe and is checked: the
 * bundle gate in `apps/web/scripts/check-bundle.mjs` fails the build if the
 * Supabase SDK ever reaches a browser chunk, and `./server` is the only thing
 * here that touches it.
 */

export {
  IDENTITY_LEVELS,
  VOICE_TOOLS,
  atLeast,
  type ActiveJourney,
  type IdentityLevel,
  type IssuedSession,
  type RefusalCode,
  type SessionBudget,
  type SessionStatus,
  type SpeakableFact,
  type ToolCall,
  type ToolResult,
  type VoiceEvent,
  type VoiceEventName,
  type VoiceProvider,
  type VoiceSession,
  type VoiceToolName,
} from "./types";

export {
  ADMIN_LOCKOUT_MS,
  CAPACITY,
  FORBIDDEN_TOOL_NAMES,
  LIMITS,
  RATE_LIMITS,
  RETENTION_DAYS,
  SECURITY_COOLDOWN,
  TIERS,
  TOOL_POLICY,
  WARN_AT_MS,
  readOnlyToolsFor,
  toolsFor,
  type Limits,
  type Tier,
  type ToolRule,
} from "./policy";

/**
 * Event names and the beacon body, exported from the root because the browser
 * needs both. Everything else under `./ops` reaches Postgres and stays server
 * side — see `./server`.
 */
export { APP_EVENTS, AppEventBody, type AppEventName } from "./ops/events";

export { RawPhone, SessionRequest, TOOL_ARGUMENTS, ToolRequest, VapiWebhook, isVoiceTool } from "./schemas";

export {
  asCallerData,
  checkInput,
  checkOutput,
  redact,
  redactText,
  type InputCheck,
  type InputVerdict,
  type OutputCheck,
} from "./guardrails";

export {
  projectJourney,
  projectMatches,
  projectPlan,
  projectStep,
  type VoiceJourney,
  type VoicePlan,
  type VoiceQuestion,
} from "./projection";

export {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VOICE,
  instructionsFor,
  realtimeSessionConfig,
  realtimeTools,
  type InstructionContext,
  type RealtimeSessionConfig,
  type RealtimeTool,
} from "./agent";

export { emit, setVoiceSinks, type VoiceSink } from "./telemetry";
