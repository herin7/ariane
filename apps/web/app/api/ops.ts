import { supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import { memoryOps, supabaseOps, voiceRuntime, type OpsStore } from "@ariane/voice/server";

/**
 * The operational store, for routes that are not voice.
 *
 * Sign-in limits and the funnel need the same counters voice does, but they
 * must keep working on a deployment with no realtime keys — a citizen should be
 * able to log in and search on a box where nobody has configured a microphone.
 * So this reaches for the voice runtime's store when there is one and builds
 * its own from the same credentials when there is not.
 *
 * Reaching for the runtime's first is not an optimisation. `memoryOps` holds
 * its counters in a Map, and two of them are two different opinions about the
 * same rate limit.
 *
 * Not a route.
 */

let fallback: OpsStore | undefined;

export function ops(): OpsStore {
  const voice = voiceRuntime();
  if (voice.ready) return voice.ops;

  if (!fallback) {
    const config = supabaseConfigFromEnv();
    fallback = config ? supabaseOps(supabaseClient(config)) : memoryOps();
  }
  return fallback;
}
