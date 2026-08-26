import { loadGraphFrom } from "./data/index";
import { graphOrigin, loadGraph, localGraphProvider, snapshotPresent, type GraphProvider } from "./data/providers";
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
// The data plane. Server only because every one of them reads a disk or a
// socket, and because `@ariane/core` root is what a browser bundle can see.
export {
  FixtureGraphProvider,
  SnapshotGraphProvider,
  graphOrigin,
  hasProductionGraph,
  loadGraph,
  localGraphProvider,
  snapshotDir,
  snapshotPresent,
  type GraphOrigin,
  type GraphProvider,
  type LocalGraphProvider,
} from "./data/providers";
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

/** Production is anywhere a citizen can reach. Fixture rows may not be served there. */
const isProduction = (env: NodeJS.ProcessEnv = process.env) => env.NODE_ENV === "production";

export class NoProductionGraphError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to serve a graph in production: ${reason}. Set SUPABASE_URL and SUPABASE_ANON_KEY, ` +
        `or point ARIANE_GRAPH_DIR at a snapshot from \`pnpm data:sync\`.`,
    );
    this.name = "NoProductionGraphError";
  }
}

/**
 * What a citizen's request reaches. Supabase first, always.
 *
 * The fallback is the whole point of this function and it is deliberately not
 * symmetric. A stale-by-a-minute real graph beats an error page, so a
 * transient Supabase failure falls through to a local snapshot of the same
 * rows. Four invented nodes about a tree felling permit do not beat an error
 * page, so in production the fixture is never served: somebody who asked about
 * a widow's pension gets a 500 and an alert, not a confident wrong answer.
 *
 * Outside production the fixture is exactly what you want, and it is what a
 * clone with no credentials gets.
 */
export async function loadLiveGraph(): Promise<GraphData> {
  const config = supabaseConfigFromEnv();
  if (!config) return localOrRefuse("SUPABASE_URL and SUPABASE_ANON_KEY are not set");

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
    console.error("Supabase unreachable for this request.", error);
    return localOrRefuse("Supabase is unreachable");
  }
}

/**
 * The local plane, or nothing.
 *
 * A snapshot is the real graph and is safe to serve anywhere. A fixture is not,
 * and the difference is checked here rather than trusted to whoever set the
 * environment variables.
 */
function localOrRefuse(reason: string): GraphData {
  if (isProduction() && !snapshotPresent()) throw new NoProductionGraphError(reason);
  if (graphOrigin() === "fixture") {
    console.warn(`${reason}. Serving fixtures/demo, which is four invented nodes and not government data.`);
  }
  return loadGraph();
}

/** Which plane this process would answer a request from. For the health route and the logs. */
export function activeGraphProvider(): GraphProvider {
  return supabaseConfigFromEnv()
    ? { origin: "supabase", describe: "supabase", load: loadLiveGraph }
    : localGraphProvider();
}

/**
 * Whether a page may be rendered ahead of time.
 *
 * A prerender bakes rows into HTML that then ships inside the build artifact.
 * Real rows are fine there and it is how the site is fast. Four invented nodes
 * about a tree felling permit are not: a build with no credentials and no
 * snapshot would otherwise freeze the fixture into `/`, `/browse` and
 * `/journey`, and `localOrRefuse` never gets asked again because the HTML is
 * already written.
 *
 * So a keyless build renders those pages per request instead, which costs one
 * clone that was never going to be deployed a little latency, and keeps the
 * refusal in front of every citizen who asks.
 */
export const canPrerender = (): boolean => activeGraphProvider().origin !== "fixture";
