import { GRAPH } from "./ingest/lib.mjs";
import { readdirSync } from "node:fs";

/**
 * The one thing `pnpm gates:integration` checks that `pnpm gates` cannot.
 *
 *   pnpm gates              public. Runs on fixtures/demo, needs no secret.
 *   pnpm gates:integration  the same gates, against the real graph.
 *
 * Without this the two commands are indistinguishable: a maintainer who has not
 * run `pnpm data:sync` gets a green integration run over four invented nodes and
 * believes the real graph was checked. That is the failure this file exists to
 * make loud, and it is why the number below is a floor rather than "more than
 * zero" — a partially synced directory is not the graph either.
 */

const MINIMUM_BUNDLES = 10;

let bundles = [];
try {
  bundles = readdirSync(GRAPH).filter((f) => f.endsWith(".json") && f !== "jurisdictions.json");
} catch {
  // Falls through to the same message. A missing directory and an empty one are
  // the same problem to whoever has to fix it.
}

if (bundles.length < MINIMUM_BUNDLES) {
  console.error(`${GRAPH} holds ${bundles.length} bundle(s), and the real graph has at least ${MINIMUM_BUNDLES}.`);
  console.error("Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm data:sync");
  console.error("Public contributors want `pnpm gates`, which runs on fixtures and needs no credentials.");
  process.exit(1);
}

console.log(`${bundles.length} bundle(s) in ${GRAPH}. Running the gates against the real graph.`);
