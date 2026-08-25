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
// Server only because it reads the seed and the research files off disk. It
// reports on the checked in bundles, not on Supabase, which is the point: it
// answers "what did we ship" and not "what is live right now".
export { coverage, coverageOf, type JourneyCoverage } from "./cli/coverage";
export { sarvamKeyFromEnv, understand, type Understood } from "./lang/sarvam";
// The three pass intent chain. Server only because passes 2 and 3 hold API
// keys. Shared so the search box and the voice agent resolve a sentence the
// same way rather than drifting apart.
export { resolveIntentDeeply, type DeepIntentResult } from "./lang/resolve";
export {
  bedrockConfigFromEnv,
  pickService,
  type BedrockConfig,
  type ServiceChoice,
} from "./lang/bedrock";

let live: { at: number; graph: Promise<GraphData> } | undefined;

/**
 * How long a loaded graph is trusted before we ask Postgres again.
 *
 * Matches the `revalidate` on the pages. Reading the whole graph is one round
 * trip of a few hundred rows, so this is about not doing it per request, not
 * about it being expensive. Anything longer and "an edit, not a deploy" stops
 * being true, which is most of the argument for having a database at all.
 */
const TTL_MS = 60_000;

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

  if (!live || Date.now() - live.at > TTL_MS) {
    const graph = (async () => {
      const { bundles, jurisdictions } = await loadFromSupabase(supabaseClient(config));
      if (!bundles.length) throw new Error("Supabase answered with an empty graph");
      return loadGraphFrom(bundles, jurisdictions);
    })();

    // Only a success is cached. Caching the fallback meant one transient error
    // on the first request after boot pinned the whole process to the seed
    // until somebody restarted it, and nothing said so except one log line.
    live = { at: Date.now(), graph };
    graph.catch(() => {
      if (live?.graph === graph) live = undefined;
    });
  }

  try {
    return await live.graph;
  } catch (error) {
    console.error("Supabase unreachable, serving the checked in seed for this request.", error);
    return loadGraph();
  }
}
