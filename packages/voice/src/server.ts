/**
 * Server only entry: `@ariane/voice/server`.
 *
 * Same door, same reason as `@ariane/core/server`. Everything reachable from
 * here holds a secret, opens a socket, or both: the Supabase SDK, the OpenAI
 * key, the Vapi webhook secret, the session HMAC. None of it has any business
 * in a browser bundle and the bundle gate fails the build if it gets there.
 */

export { VoiceBroker, type BrokerConfig } from "./broker";
export { VoiceSessions, type CreateSessionInput, type CreateSessionResult, type SessionsConfig } from "./session";
export {
  memoryStore,
  supabaseStore,
  type Citizen,
  type ConsentState,
  type PreferenceKey,
  type StoredDocument,
  type StoredJourney,
  type VoiceStore,
} from "./store";
export {
  callerHash,
  hashPhone,
  hashToken,
  initialIdentityLevel,
  newSessionId,
  newToken,
  normalisePhone,
  stubCodeFor,
  stubStepUp,
  tokenMatches,
  type StepUpProvider,
} from "./identity";
export {
  RealtimeNotConfiguredError,
  mintClientSecret,
  realtimeConfigured,
  type EphemeralCredential,
} from "./transport/browser";
export {
  parseVapiEvent,
  vapiConfigured,
  vapiToolResponse,
  verifyVapiSignature,
  type VapiEvent,
  type VapiEventType,
  type VerifyResult,
} from "./transport/vapi";
export { consoleSink, defaultSinks, langfuseSink } from "./telemetry";
export { voiceRuntime, type VoiceRuntime } from "./runtime";
