import { randomBytes } from "node:crypto";
import { loadLiveGraph, planGoals, resolveIntentDeeply, supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import { VoiceBroker } from "./broker";
import { VoiceCapacity } from "./ops/capacity";
import { SecurityLog } from "./ops/security";
import { memoryOps, supabaseOps, type OpsStore } from "./ops/store";
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
  /** Capacity, queue, limits and telemetry. Postgres in production. */
  ops: OpsStore;
  capacity: VoiceCapacity;
  security: SecurityLog;
  /** The key that turns an address into an `ip_hash`. Never leaves the server. */
  rateSecret: string;
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
  const rateSecret = secret(env, "RATE_LIMIT_SECRET");

  // Postgres when it is configured, memory when it is not. Same decision
  // `loadLiveGraph` makes about the graph, so a clone with no credentials runs
  // the whole voice path end to end and only loses what a restart would.
  const config = supabaseConfigFromEnv();
  const db = config ? supabaseClient(config) : undefined;
  const store = db ? supabaseStore(db) : memoryStore();
  const ops = db ? supabaseOps(db) : memoryOps();

  if (!sessionSecret || !phoneSecret || !rateSecret) {
    // Fail closed and say so once. `ready: false` is what the routes turn into
    // a 503; constructing `VoiceSessions` without a secret would throw here and
    // take the whole route module down with it.
    console.error(
      "Voice is disabled: VOICE_SESSION_SECRET, VOICE_PHONE_HMAC_SECRET and RATE_LIMIT_SECRET are required.",
    );
    runtime = { ready: false } as unknown as VoiceRuntime;
    return runtime;
  }

  /**
   * The one configuration mistake that is silent and expensive.
   *
   * Without Postgres, `memoryOps` decides capacity — and it decides it per
   * process. Vercel runs many, so "ten concurrent calls" quietly becomes ten
   * per instance and the ceiling this whole subsystem exists to enforce is
   * gone. There is no partial version of this to fall back to, so voice stays
   * off until somebody sets the credentials.
   */
  if (!ops.durable && env.NODE_ENV === "production") {
    console.error("Voice is disabled: capacity and rate limits need Postgres, and Supabase is not configured.");
    runtime = { ready: false } as unknown as VoiceRuntime;
    return runtime;
  }

  const sessions = new VoiceSessions({ store, secret: sessionSecret, phoneSecret });
  const broker = new VoiceBroker({
    sessions,
    store,
    graph: loadLiveGraph,
    resolveNeed: resolveIntentDeeply,
    // The scoping questions `planGoals` can return are dropped on this path on
    // purpose: on a phone call the model asks them itself, in conversation,
    // and answering by voice into a question id nobody can see is a worse
    // version of a conversation. The screen at /plan gets them as buttons.
    planNeed: (graph, text) => planGoals(graph, text),
  });

  runtime = {
    sessions,
    broker,
    store,
    ops,
    capacity: new VoiceCapacity(ops),
    security: new SecurityLog(ops),
    rateSecret,
    ready: true,
  };
  return runtime;
}
