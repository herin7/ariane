import { loadGraph, loadGraphFrom } from "./data/index";
import { loadFromSupabase, supabaseClient, supabaseConfigFromEnv } from "./db/supabase";
import type { GraphData } from "./types";

/**
 * Server only entry: `@ariane/core/server`.
 *
 * Everything that talks to the database is behind this door rather than the
 * package root, because anything reachable from the root ends up in the
 * browser bundle, and the Supabase SDK is 64kB a citizen has no use for on a
 * page that never opens a socket to Postgres.
 */

export {
  loadFromSupabase,
  pushToSupabase,
  supabaseClient,
  supabaseConfigFromEnv,
  type SupabaseConfig,
} from "./db/supabase";
export { jurisdictionRows, toBundles, toJurisdictions, toRows, type GraphRows } from "./db/rows";
export { sarvamKeyFromEnv, understand, type Understood } from "./lang/sarvam";
export {
  bedrockConfigFromEnv,
  pickService,
  type BedrockConfig,
  type ServiceChoice,
} from "./lang/bedrock";

let live: Promise<GraphData> | undefined;

/**
 * The database when there is one, the seed when there is not.
 *
 * This is what request handlers call, so an office address corrected in
 * Supabase reaches a citizen without a deploy. If the database is unreachable
 * the seed answers instead: a slightly stale journey beats an error page, and
 * every fact in the seed was read off an official page the same as the rows
 * were.
 */
export async function loadLiveGraph(): Promise<GraphData> {
  const config = supabaseConfigFromEnv();
  if (!config) return loadGraph();

  // Only a success is cached. Caching the fallback meant one transient error on
  // the first request after boot pinned the whole process to the seed until
  // somebody restarted it, and nothing said so except a single old log line.
  live ??= (async () => {
    const { bundles, jurisdictions } = await loadFromSupabase(supabaseClient(config));
    if (!bundles.length) throw new Error("Supabase answered with an empty graph");
    return loadGraphFrom(bundles, jurisdictions);
  })().catch((error) => {
    live = undefined;
    throw error;
  });

  try {
    return await live;
  } catch (error) {
    console.error("Supabase unreachable, serving the checked in seed for this request.", error);
    return loadGraph();
  }
}
