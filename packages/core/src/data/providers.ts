import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphData, Jurisdiction } from "../types";
import { journeysOf, loadGraphFrom, type GraphBundle } from "./index";

/**
 * Where the graph comes from, said out loud.
 *
 * Ariane's rows are government facts. They are not source code, they are not
 * ours to redistribute, and a 150,000 line diff in front of a reviewer is not
 * review. So they live in the database and in a private snapshot, and this file
 * is the only place that decides which of the three planes a process is on:
 *
 *   supabase   production. The live graph, edited without a deploy.
 *   snapshot   a maintainer's local copy of that graph, from `pnpm data:sync`.
 *   fixture    one synthetic service, checked in, for public tests.
 *
 * The rule that matters is one way: a fixture must never answer a citizen.
 * `loadLiveGraph` in `../server` refuses to serve fixture rows in production
 * rather than quietly serving four nodes to somebody who asked about a pension.
 *
 * Server only. It reads the disk, so nothing here may be reachable from the
 * package root; `@ariane/core` root is what a browser bundle can see.
 */

export type GraphOrigin = "supabase" | "snapshot" | "fixture";

export interface GraphProvider {
  readonly origin: GraphOrigin;
  /** Human readable, for the one line an operator needs to know which plane they are on. */
  readonly describe: string;
  load(): Promise<GraphData>;
}

/**
 * A provider that can answer without a network round trip.
 *
 * The CLIs, the compiler tests and `pnpm graph:validate` are all synchronous
 * and have no reason not to be. Supabase is the only provider that cannot be,
 * which is why this is a narrower interface rather than everything returning a
 * promise for the benefit of one implementation.
 */
export interface LocalGraphProvider extends GraphProvider {
  /** The directory itself, for the CLIs that report where they read from. */
  readonly dir: string;
  loadSync(): GraphData;
  bundles(): GraphBundle[];
  jurisdictions(): Jurisdiction[];
  /**
   * Bundle file names that compile as a goal, so `quotes:audit` and `coverage`
   * do not keep their own copy of the list. Template packs are excluded: nothing
   * names one as a goal and no researcher wrote a file behind one.
   */
  journeys(): string[];
  /** The evidence behind a journey, or undefined when nobody recorded any. */
  research(name: string): ResearchFile | undefined;
  bundle(name: string): GraphBundle;
}

/**
 * What a researcher recorded for one journey.
 *
 * Loosely typed on purpose. Two of these were hand written, the rest are
 * pipeline output across a year of format drift, and the two gates that read
 * them want four fields between them. A strict interface here would be a lie
 * with a compiler behind it.
 */
export interface ResearchFile {
  facts?: { claim?: string; evidence?: string; sourceId?: string }[];
  sources?: { id?: string; url?: string; title?: string; scrapedOk?: boolean }[];
  notFound?: unknown[];
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

/**
 * Repository root, from `packages/core/src/data/`.
 *
 * Built with `path.join` rather than `new URL("../../../../", import.meta.url)`,
 * which reads to webpack as a static asset reference and fails the web build
 * with `Can't resolve '../../../../'`. Same directory, no bundler opinion.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * Reads a directory of bundle files, `jurisdictions.json` apart.
 *
 * Same layout the snapshot and the fixture use, because they are the same
 * thing at two sizes and a second format would be a second thing to keep
 * right.
 */
function readDirectory(dir: string): {
  named: { name: string; bundle: GraphBundle }[];
  jurisdictions: Jurisdiction[];
} {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "jurisdictions.json")
    .sort();

  const jurisdictionsPath = `${dir}/jurisdictions.json`;
  return {
    named: files.map((f) => ({ name: f.replace(/\.json$/, ""), bundle: readJson(`${dir}/${f}`) as GraphBundle })),
    jurisdictions: existsSync(jurisdictionsPath) ? (readJson(jurisdictionsPath) as Jurisdiction[]) : [],
  };
}

function localProvider(origin: GraphOrigin, describe: string, dir: string): LocalGraphProvider {
  let cache: ReturnType<typeof readDirectory> | undefined;
  const read = () => (cache ??= readDirectory(dir));

  return {
    origin,
    describe,
    dir,
    bundles: () => read().named.map((n) => n.bundle),
    jurisdictions: () => read().jurisdictions,
    // Load order decides which duplicate question definition wins, so journeys
    // come first and template packs last, deterministically, the same way the
    // generated manifest used to order them.
    journeys: () => read().named.filter((n) => !n.bundle.edgeTemplates?.length).map((n) => n.name),
    bundle(name) {
      const hit = read().named.find((n) => n.name === name);
      if (!hit) throw new Error(`no bundle named ${name} in ${dir}`);
      return hit.bundle;
    },
    research(name) {
      const path = `${dir}/research/${name}.json`;
      return existsSync(path) ? (readJson(path) as ResearchFile) : undefined;
    },
    loadSync() {
      const { named, jurisdictions } = read();
      const bundles = named.map((n) => n.bundle);
      // Journeys first, template packs last. `dedupeQuestions` is first-wins, so
      // this order is what a citizen is asked, and it has to be the same order
      // every run on every machine rather than whatever readdir felt like.
      return loadGraphFrom([...journeysOf(bundles), ...bundles.filter((b) => b.edgeTemplates?.length)], jurisdictions);
    },
    async load() {
      return this.loadSync();
    },
  };
}

/**
 * `fixtures/demo/`. One invented service on `example.gov.invalid`.
 *
 * This is what a clone with no credentials gets, and it is deliberately far too
 * small to be mistaken for the real thing. Four nodes. If a production journey
 * ever came back with a tree felling permit in it, that is this provider having
 * escaped, and it should be obvious within one screenful rather than subtle.
 */
export const FixtureGraphProvider = (): LocalGraphProvider =>
  localProvider("fixture", "fixtures/demo", join(repoRoot, "fixtures", "demo"));

/** Where `pnpm data:sync` writes, and where a maintainer's real graph lives. */
export const snapshotDir = (env: NodeJS.ProcessEnv = process.env): string =>
  env.ARIANE_GRAPH_DIR ?? join(repoRoot, ".graph");

export const snapshotPresent = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const dir = snapshotDir(env);
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json") && f !== "jurisdictions.json");
};

/**
 * A maintainer's local copy of the production graph.
 *
 * Gitignored, fetched with `pnpm data:sync`, and the thing `pnpm
 * gates:integration` runs against. An empty or missing directory is not a
 * snapshot: `snapshotPresent` is false and the caller falls back or fails,
 * rather than this returning zero bundles and letting a green run mean nothing.
 */
export const SnapshotGraphProvider = (env: NodeJS.ProcessEnv = process.env): LocalGraphProvider =>
  localProvider("snapshot", snapshotDir(env), snapshotDir(env));

/**
 * The snapshot when a maintainer has one, the fixture otherwise.
 *
 * Never Supabase: this is the synchronous path, used by CLIs and tests. The
 * production path is `loadLiveGraph`, which prefers the database and is the
 * only thing a citizen's request ever reaches.
 */
export function localGraphProvider(env: NodeJS.ProcessEnv = process.env): LocalGraphProvider {
  return snapshotPresent(env) ? SnapshotGraphProvider(env) : FixtureGraphProvider();
}

let cached: { origin: GraphOrigin; graph: GraphData } | undefined;

/**
 * The local graph, synchronously, cached for the life of the process.
 *
 * What the CLIs and the compiler tests call. Which plane it is depends only on
 * whether a snapshot is on disk, so the same command proves the compiler
 * against one invented service in public CI and against 553 real ones on a
 * maintainer's laptop, without a flag.
 */
export function loadGraph(env: NodeJS.ProcessEnv = process.env): GraphData {
  const provider = localGraphProvider(env);
  if (cached?.origin !== provider.origin) cached = { origin: provider.origin, graph: provider.loadSync() };
  return cached.graph;
}

/** Which plane the current process is on. Tests use it to skip what they cannot prove. */
export const graphOrigin = (env: NodeJS.ProcessEnv = process.env): GraphOrigin => localGraphProvider(env).origin;

/** True when the graph in hand is the real one, so a real assertion is worth making. */
export const hasProductionGraph = (env: NodeJS.ProcessEnv = process.env): boolean => graphOrigin(env) !== "fixture";
