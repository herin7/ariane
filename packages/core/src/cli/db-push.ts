import { validateGraph } from "../data/index";
import { localGraphProvider } from "../data/providers";
import {
  deleteRows,
  loadFromSupabase,
  orphansInSupabase,
  pushToSupabase,
  supabaseClient,
  supabaseConfigFromEnv,
} from "../db/supabase";

/**
 * Load the local snapshot into Supabase, then read it back and check it came
 * back the same.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm db:push
 *   pnpm db:push --prune     # also remove rows the seed no longer contains
 *
 * Run `src/db/schema.sql` first. This writes rows, it does not create tables,
 * because a script that can reshape the schema is a script that can drop a
 * column of government facts on a bad day.
 *
 * The snapshot is validated before anything is written. Pushing a graph that
 * `graph:validate` rejects would put a broken fact in front of a citizen, and
 * the whole point of the database is that it is what citizens read.
 *
 * It refuses to run against fixtures. `fixtures/demo` is four invented nodes,
 * and the difference between "the snapshot is missing" and "the graph is four
 * nodes about a tree" is one `pnpm data:sync` a maintainer forgot, on the one
 * command in this repository that overwrites production.
 */

const config = supabaseConfigFromEnv();
if (!config) {
  console.error("No SUPABASE_URL and key in the environment. Nothing pushed.");
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run again.");
  process.exit(1);
}

const graph = localGraphProvider();
if (graph.origin === "fixture") {
  console.error("Refusing to push fixtures/demo over the live graph. Run pnpm data:sync first.");
  process.exit(1);
}

const seedBundles = graph.bundles();
const seedJurisdictions = graph.jurisdictions();

const problems = validateGraph(graph.loadSync()).filter((i) => i.severity === "ERROR");
if (problems.length) {
  console.error(`Snapshot has ${problems.length} error(s). Fix them before writing any of it to the database.`);
  for (const p of problems) console.error(`  ${p.code} ${p.message}`);
  process.exit(1);
}

const db = supabaseClient(config);

console.log(`pushing ${seedBundles.length} bundle(s) to ${config.url}`);
await pushToSupabase(db, seedBundles, seedJurisdictions, (line) => console.log(`  ${line}`));

/**
 * The push upserts and never deletes, which is right, and leaves the database
 * holding facts the seed has since dropped, which is not. Read back below then
 * fails with "94 item(s) went in, 95 came back", a sentence that sounds like a
 * truncated write and is actually a source we removed a month ago still being
 * served. Name them, delete them only when asked.
 */
const orphans = await orphansInSupabase(db, seedBundles);
if (orphans.length && process.argv.includes("--prune")) {
  await deleteRows(db, orphans);
  console.log(`  pruned ${orphans.length} row(s) the seed no longer contains`);
  for (const o of orphans) console.log(`    ${o.table} ${o.id} ${o.label}`);
} else if (orphans.length) {
  console.log(`  ${orphans.length} row(s) in the database are not in the seed, and were left alone:`);
  for (const o of orphans.slice(0, 20)) console.log(`    ${o.table} ${o.id} ${o.label}`);
  if (orphans.length > 20) console.log(`    and ${orphans.length - 20} more`);
  console.log("  Run pnpm db:push --prune to remove them.");
}

// Reading it back is the only thing that proves the write actually landed the
// way the seed reads. A silently truncated jsonb column looks fine until a
// citizen opens the step it belonged to.
const { bundles, jurisdictions } = await loadFromSupabase(db);
/**
 * Sources compare as one set, everything else per bundle.
 *
 * A source id is a hash of its URL, so two journeys that read the same page get
 * the same id, and the table holds one row per id. 42 of 1,117 sources are
 * cited by more than one journey and only one row can carry the journey column,
 * so the other journey reads back one source short and this check called it
 * corruption.
 *
 * It is not a lost fact. `loadGraphFrom` flattens sources across every bundle
 * and dedupes by id before a citation is ever resolved, so which journey a
 * shared page is filed under never reaches a citizen. A source going missing
 * altogether is a lost fact, and comparing the union still catches that, along
 * with any column that came back changed.
 */
const sortBundles = (list: typeof bundles) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id)).map((b) => ({
    ...b,
    nodes: [...b.nodes].sort((x, y) => x.id.localeCompare(y.id)),
    edges: [...b.edges].sort((x, y) => x.id.localeCompare(y.id)),
    sources: [],
    requirementGroups: [...b.requirementGroups].sort((x, y) => x.id.localeCompare(y.id)),
    questions: [...b.questions].sort((x, y) => x.field.localeCompare(y.field)),
  }));

const allSources = (list: typeof bundles) =>
  [...new Map(list.flatMap((b) => b.sources).map((s) => [s.id, s])).values()].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Key order is not a fact. Postgres hands back columns in its own order and
 * jsonb reorders object keys by design, so comparing raw JSON strings fails on
 * a database that is perfectly correct. Sort the keys, then compare.
 */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** First real difference, with a path, because "it differs" is not actionable. */
function firstDifference(a: unknown, b: unknown, path = ""): string | undefined {
  if (a === b) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: ${a.length} item(s) went in, ${b.length} came back`;
    for (const [i, item] of a.entries()) {
      const found = firstDifference(item, b[i], `${path}[${i}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference((a as never)[key], (b as never)[key], `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  }
  return `${path}: ${JSON.stringify(a)} went in, ${JSON.stringify(b)} came back`;
}

const expectedBundles = sortBundles(seedBundles);
const actualBundles = sortBundles(bundles);
const sortJurisdictions = (list: typeof jurisdictions) => [...list].sort((a, b) => a.id.localeCompare(b.id));

console.log(`read back ${bundles.length} bundle(s), ${jurisdictions.length} jurisdiction(s)`);

const expectedSources = allSources(seedBundles);
const actualSources = allSources(bundles);

const mismatch =
  stable(expectedBundles) !== stable(actualBundles)
    ? (firstDifference(expectedBundles, actualBundles, "bundles") ?? "bundles differ")
    : stable(expectedSources) !== stable(actualSources)
      ? (firstDifference(expectedSources, actualSources, "sources") ?? "sources differ")
    : stable(sortJurisdictions(seedJurisdictions)) !== stable(sortJurisdictions(jurisdictions))
      ? (firstDifference(sortJurisdictions(seedJurisdictions), sortJurisdictions(jurisdictions), "jurisdictions") ??
        "jurisdictions differ")
      : undefined;

if (mismatch) {
  console.error("What came back is not what went in. Do not point the app at this yet.");
  console.error(`  ${mismatch}`);
  process.exit(1);
}

console.log("Round tripped clean. The database now holds the graph.");
