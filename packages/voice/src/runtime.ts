import { randomBytes } from "node:crypto";
import { loadLiveGraph, resolveIntentDeeply, supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import { VoiceBroker } from "./broker";
import { VoiceSessions } from "./session";
import { memoryStore, supabaseStore, type VoiceStore } from "./store";
import { defaultSinks, setVoiceSinks } from "./telemetry";

/**
 * The wiring, assembled once per process.
 *
 * Four route handlers need the same store, the same session registry and the
 * same broker, and a broker per request would give every request its own loop
 * counter and its own in-memory sessions. So this is a module-level singleton,
 * the same shape as `loadLiveGraph`'s cache in `@ariane/core/server` and for
 * the same reason.
 */

export interface VoiceRuntime {
  sessions: VoiceSessions;
  broker: VoiceBroker;
  store: VoiceStore;
  /** False when the secrets are missing in production. Routes answer 503. */
  ready: boolean;
}

let runtime: VoiceRuntime | undefined;

/**
 * A secret, or a throwaway one on a developer's laptop.
 *
 * In production a missing secret is a misconfiguration and voice refuses to
 * start rather than keying its session tokens with a constant. In development
 * it is a person who wants to try the thing, so they get random bytes that live
 * as long as the process: sessions do not survive a restart, which is the
 * correct amount of durability for a secret nobody chose.
 */
function secret(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  if (value) return value;
  if (env.NODE_ENV === "production") return undefined;
  console.warn(`${name} is not set. Using a per-process random value; voice sessions will not survive a restart.`);
  return randomBytes(32).toString("hex");
}

export function voiceRuntime(env: Record<string, string | undefined> = process.env): VoiceRuntime {
  if (runtime) return runtime;

  setVoiceSinks(defaultSinks(env));

  const sessionSecret = secret(env, "VOICE_SESSION_SECRET");
  const phoneSecret = secret(env, "VOICE_PHONE_HMAC_SECRET");

  // Postgres when it is configured, memory when it is not. Same decision
  // `loadLiveGraph` makes about the graph, so a clone with no credentials runs
  // the whole voice path end to end and only loses what a restart would.
  const config = supabaseConfigFromEnv();
  const store = config ? supabaseStore(supabaseClient(config)) : memoryStore();

  if (!sessionSecret || !phoneSecret) {
    // Fail closed and say so once. `ready: false` is what the routes turn into
    // a 503; constructing `VoiceSessions` without a secret would throw here and
    // take the whole route module down with it.
    console.error("Voice is disabled: VOICE_SESSION_SECRET and VOICE_PHONE_HMAC_SECRET are required.");
    runtime = { ready: false } as unknown as VoiceRuntime;
    return runtime;
  }

  const sessions = new VoiceSessions({ store, secret: sessionSecret, phoneSecret });
  const broker = new VoiceBroker({
    sessions,
    store,
    graph: loadLiveGraph,
    resolveNeed: resolveIntentDeeply,
  });

  runtime = { sessions, broker, store, ready: true };
  return runtime;
}
