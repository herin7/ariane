import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GraphBundle } from "../data/index";
import type { Jurisdiction } from "../types";
import { jurisdictionRows, toBundles, toJurisdictions, toRows, type GraphRows } from "./rows";

/**
 * Supabase, holding the government facts.
 *
 * Reads use the anon key against public-read tables, because everything in
 * here is published government information. Writes need the service role key
 * and only happen from `pnpm db:push`, which is a person deliberately loading
 * a seed, never a request.
 *
 * Nothing in this file is required to run the product. `loadGraph()` reads the
 * checked in seed and is what tests, CI and a laptop on a train use. The
 * database is what makes a fee correctable without a deploy.
 */

export interface SupabaseConfig {
  url: string;
  key: string;
}

/**
 * Config from the environment, or undefined when there is none. Undefined is a
 * normal state, not an error: the seed is a working fallback.
 */
export function supabaseConfigFromEnv(env: Record<string, string | undefined> = process.env): SupabaseConfig | undefined {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : undefined;
}

export function supabaseClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.key, { auth: { persistSession: false } });
}

/**
 * PostgREST caps a response at 1000 rows however wide you open the range, so
 * everything reads in pages. The graph is smaller than that today and will not
 * stay that way.
 */
const PAGE = 1000;

async function readAll(db: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    // Ordered by id so a journey's rows come back the same way every time.
    const { data, error } = await db.from(table).select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

export async function loadFromSupabase(
  db: SupabaseClient,
): Promise<{ bundles: GraphBundle[]; jurisdictions: Jurisdiction[] }> {
  const [journeys, sources, nodes, edges, requirement_groups, questions, escalation_templates, jurisdictions] =
    await Promise.all([
      readAll(db, "journeys"),
      readAll(db, "sources"),
      readAll(db, "nodes"),
      readAll(db, "edges"),
      readAll(db, "requirement_groups"),
      readAll(db, "questions"),
      readAll(db, "escalation_templates"),
      readAll(db, "jurisdictions"),
    ]);

  const rows: GraphRows = {
    journeys: journeys as GraphRows["journeys"],
    sources,
    nodes,
    edges,
    requirement_groups,
    escalation_templates,
    // `questions` is keyed by field, not id, so it needs its own ordering.
    questions: [...questions].sort((a, b) => String(a.field).localeCompare(String(b.field))),
  };

  return { bundles: toBundles(rows), jurisdictions: toJurisdictions(jurisdictions) };
}

/**
 * Load the seed into the database.
 *
 * Order matters: jurisdictions and journeys are pointed at by everything,
 * nodes are pointed at by edges and groups. Upsert rather than insert so
 * re-running is safe, and so a correction made in the seed lands on the row it
 * belongs to instead of duplicating it.
 *
 * Rows deleted from the seed are NOT removed from the database. Deleting
 * government facts is an editorial act and should not be a side effect of
 * running a script.
 */
export async function pushToSupabase(
  db: SupabaseClient,
  bundles: GraphBundle[],
  jurisdictions: Jurisdiction[],
  log: (message: string) => void = () => {},
): Promise<void> {
  const rows = toRows(bundles);

  const upsert = async (table: string, values: Record<string, unknown>[], conflict = "id") => {
    for (let i = 0; i < values.length; i += PAGE) {
      const { error } = await db.from(table).upsert(values.slice(i, i + PAGE), { onConflict: conflict });
      if (error) throw new Error(`writing ${table}: ${error.message}`);
    }
    log(`${table}: ${values.length}`);
  };

  // Districts reference their state, which references the country, so the
  // parent has to exist first. Shallowest first does that without a topo sort.
  const byDepth = [...jurisdictions].sort((a, b) => a.id.split("-").length - b.id.split("-").length);
  await upsert("jurisdictions", jurisdictionRows(byDepth));
  await upsert("journeys", rows.journeys);
  await upsert("sources", rows.sources);
  await upsert("nodes", rows.nodes);
  await upsert("edges", rows.edges);
  await upsert("requirement_groups", rows.requirement_groups);
  await upsert("questions", rows.questions, "field");
  await upsert("escalation_templates", rows.escalation_templates);
}
