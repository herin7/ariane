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
  live ??= (async () => {
    const config = supabaseConfigFromEnv();
    if (!config) return loadGraph();
    try {
      const { bundles, jurisdictions } = await loadFromSupabase(supabaseClient(config));
      if (!bundles.length) return loadGraph();
      return loadGraphFrom(bundles, jurisdictions);
    } catch (error) {
      console.error("Supabase unreachable, serving the checked in seed instead.", error);
      return loadGraph();
    }
  })();
  return live;
}
