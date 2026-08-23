import { seedBundles, seedJurisdictions, validateGraph, loadGraph } from "../data/index";
import { loadFromSupabase, pushToSupabase, supabaseClient, supabaseConfigFromEnv } from "../db/supabase";

/**
 * Load the checked in seed into Supabase, then read it back and check it came
 * back the same.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm db:push
 *
 * Run `src/db/schema.sql` first. This writes rows, it does not create tables,
 * because a script that can reshape the schema is a script that can drop a
 * column of government facts on a bad day.
 *
 * The seed is validated before anything is written. Pushing a graph that
 * `graph:validate` rejects would put a broken fact in front of a citizen, and
 * the whole point of the database is that it is what citizens read.
 */

const config = supabaseConfigFromEnv();
if (!config) {
  console.error("No SUPABASE_URL and key in the environment. Nothing pushed.");
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run again.");
  process.exit(1);
}

const problems = validateGraph(loadGraph()).filter((i) => i.severity === "ERROR");
if (problems.length) {
  console.error(`Seed has ${problems.length} error(s). Fix them before writing any of it to the database.`);
  for (const p of problems) console.error(`  ${p.code} ${p.message}`);
  process.exit(1);
}

const db = supabaseClient(config);

console.log(`pushing ${seedBundles.length} bundle(s) to ${config.url}`);
await pushToSupabase(db, seedBundles, seedJurisdictions, (line) => console.log(`  ${line}`));

// Reading it back is the only thing that proves the write actually landed the
// way the seed reads. A silently truncated jsonb column looks fine until a
// citizen opens the step it belonged to.
const { bundles, jurisdictions } = await loadFromSupabase(db);
const sortBundles = (list: typeof bundles) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id)).map((b) => ({
    ...b,
    nodes: [...b.nodes].sort((x, y) => x.id.localeCompare(y.id)),
    edges: [...b.edges].sort((x, y) => x.id.localeCompare(y.id)),
    sources: [...b.sources].sort((x, y) => x.id.localeCompare(y.id)),
    requirementGroups: [...b.requirementGroups].sort((x, y) => x.id.localeCompare(y.id)),
    questions: [...b.questions].sort((x, y) => x.field.localeCompare(y.field)),
  }));

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

const mismatch =
  stable(expectedBundles) !== stable(actualBundles)
    ? (firstDifference(expectedBundles, actualBundles, "bundles") ?? "bundles differ")
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
