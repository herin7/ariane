import { mkdirSync, writeFileSync } from "node:fs";
import { snapshotDir } from "../data/providers";
import { loadFromSupabase, supabaseClient, supabaseConfigFromEnv } from "../db/supabase";

/**
 * Fetch the private graph out of the database and onto this machine.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm data:sync
 *
 * The inverse of `db:push`, and how an authorised maintainer rehydrates a
 * clone. The bundles are 7MB of third-party government facts: they belong in
 * rows, not in a diff, so they are not in git and this is how they come back.
 * They land in `.graph/`, which is gitignored, or in `$ARIANE_GRAPH_DIR` if you
 * keep them somewhere else.
 *
 * Nobody without credentials needs this. `pnpm gates` runs green on
 * `fixtures/demo` and never asks for a key; `pnpm gates:integration` is the one
 * that wants what this writes.
 *
 * Scope: the graph, which is what Supabase holds. The research evidence under
 * `.graph/research/` is the ingestion pipeline's output and stays wherever its
 * maintainer keeps it. `ARIANE_GRAPH_DIR` points at both.
 *
 * It does not validate. `db:push` validated before writing and round tripped
 * after, so anything in the database has already been through the gate; the
 * check that matters here is `pnpm graph:validate`, which runs next anyway.
 */

const config = supabaseConfigFromEnv();
if (!config) {
  console.error("No SUPABASE_URL and key in the environment. Nothing pulled.");
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run again.");
  process.exit(1);
}

const dir = snapshotDir();
mkdirSync(dir, { recursive: true });

console.log(`pulling from ${config.url} into ${dir}`);
const { bundles, jurisdictions } = await loadFromSupabase(supabaseClient(config));

if (!bundles.length) {
  console.error("The database returned no bundles. Run pnpm db:push from a machine that has them.");
  process.exit(1);
}

for (const bundle of bundles) {
  writeFileSync(`${dir}/${bundle.id}.json`, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`  ${bundle.id.padEnd(22)} ${String(bundle.nodes.length).padStart(4)} nodes`);
}
writeFileSync(`${dir}/jurisdictions.json`, `${JSON.stringify(jurisdictions, null, 2)}\n`);

console.log(`\n${bundles.length} bundle(s) written. Run pnpm graph:validate to check them.`);
