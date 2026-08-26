import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFromSupabase, supabaseClient, supabaseConfigFromEnv } from "../db/supabase";

/**
 * Write the database back out as the seed files, which are not in git.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm db:pull
 *
 * The inverse of `db:push`, and the reason a clone can still run. The bundles
 * under `data/graph/` are 7MB of government facts that belong in rows, not in
 * a diff, so they are ignored by git and this is how they come back.
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

const dir = fileURLToPath(new URL("../data/graph/", import.meta.url));

console.log(`pulling from ${config.url}`);
const { bundles, jurisdictions } = await loadFromSupabase(supabaseClient(config));

if (!bundles.length) {
  console.error("The database returned no bundles. Run pnpm db:push from a machine that has them.");
  process.exit(1);
}

for (const bundle of bundles) {
  writeFileSync(`${dir}${bundle.id}.json`, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`  ${bundle.id.padEnd(22)} ${String(bundle.nodes.length).padStart(4)} nodes`);
}
writeFileSync(`${dir}jurisdictions.json`, `${JSON.stringify(jurisdictions, null, 2)}\n`);

// The manifest is generated from whatever is on disk, and what is on disk just
// changed. Regenerating here means one command rehydrates a clone.
execFileSync("node", [fileURLToPath(new URL("../../../../scripts/bundles.mjs", import.meta.url))], {
  stdio: "inherit",
});

console.log(`\n${bundles.length} bundle(s) written. Run pnpm graph:validate to check them.`);
