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
  const key =
    // New style keys first: sb_secret_ writes, sb_publishable_ reads.
    env.SUPABASE_API_SECRET_KEY ??
    env.SUPABASE_API_KEY ??
    // Legacy JWT keys, still what most Supabase docs show.
    env.SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_ANON_KEY;

  const url = restUrl(env.SUPABASE_URL) ?? restUrl(env.SUPABASE_DB_URL);
  return url && key ? { url, key } : undefined;
}

/**
 * The dashboard hands out two different things called a URL: the REST endpoint
 * the JS client wants, and a `postgres://...` connection string that only psql
 * can use. Pasting the second one into the first one's slot fails at request
 * time with a confusing error, so recognise it and pull the project ref out.
 */
function restUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("http")) return value.replace(/\/+$/, "");
  const ref = /(?:@|\/\/)(?:db\.)?([a-z0-9]{20})\.supabase\.co/.exec(value)?.[1];
  return ref ? `https://${ref}.supabase.co` : undefined;
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

/**
 * Ordered by key so a journey's rows come back the same way every time, and so
 * paging is stable. `questions` is keyed by `field`, not `id`, which is why the
 * column is a parameter: ordering every table by `id` is a 400 from PostgREST
 * on that one table, and no amount of round tripping the seed in memory finds
 * it.
 */
async function readAll(db: SupabaseClient, table: string, key = "id"): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").order(key).range(from, from + PAGE - 1);
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
      readAll(db, "questions", "field"),
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
    /**
     * One row per key before it reaches Postgres.
     *
     * `toRows` walks bundle by bundle and stamps each row with the journey it
     * came from, which is right for the round trip and wrong for a single
     * statement: 39 sources are cited by two journeys, because a URL does not
     * stop being one page when a second service reads it, and two rows with
     * one id in one upsert is `ON CONFLICT DO UPDATE command cannot affect row
     * a second time`. The whole push died there and the database sat 117
     * services behind the seed.
     *
     * First wins, and the loss is only which journey claims the source.
     * `loadGraphFrom` flattens sources across every bundle and dedupes by id
     * before anything reads one, so no citation is resolved through the
     * journey column. Nothing about the page itself differs between the two
     * rows: same id means same URL means same fetch.
     */
    const byKey = new Map<string, Record<string, unknown>>();
    for (const value of values) {
      const key = conflict.split(",").map((k) => String(value[k.trim()])).join(" ");
      if (!byKey.has(key)) byKey.set(key, value);
    }
    const unique = [...byKey.values()];
    for (let i = 0; i < unique.length; i += PAGE) {
      const { error } = await db.from(table).upsert(unique.slice(i, i + PAGE), { onConflict: conflict });
      if (error) throw new Error(`writing ${table}: ${error.message}`);
    }
    log(`${table}: ${unique.length}${unique.length === values.length ? "" : ` (${values.length - unique.length} shared with another journey)`}`);
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

/**
 * Rows the database still holds that the seed no longer contains.
 *
 * `pushToSupabase` upserts and never deletes, on purpose. The cost of that
 * purpose is that once a fact leaves the seed the database quietly keeps
 * serving it, and `db:push` reports the drift as "94 item(s) went in, 95 came
 * back", which reads like corruption and is actually an old row nobody removed.
 * Name them instead, so removing one stays a decision somebody makes.
 *
 * Children first in the returned order, so a caller deleting the list top to
 * bottom never orphans a row it has not reached yet.
 */
export async function orphansInSupabase(
  db: SupabaseClient,
  bundles: GraphBundle[],
): Promise<{ table: string; key: string; id: string; label: string }[]> {
  const seed = toRows(bundles);
  const tables = [
    ["edges", "id", seed.edges],
    ["requirement_groups", "id", seed.requirement_groups],
    ["escalation_templates", "id", seed.escalation_templates],
    ["questions", "field", seed.questions],
    ["nodes", "id", seed.nodes],
    ["sources", "id", seed.sources],
    ["journeys", "id", seed.journeys],
  ] as const;

  const found: { table: string; key: string; id: string; label: string }[] = [];
  for (const [table, key, values] of tables) {
    const known = new Set(values.map((v) => String((v as Record<string, unknown>)[key])));
    for (const row of await readAll(db, table, key)) {
      const id = String(row[key]);
      if (known.has(id)) continue;
      found.push({ table, key, id, label: String(row.url ?? row.name ?? row.label ?? row.type ?? "") });
    }
  }
  return found;
}

/** Delete exactly the rows named. No filters, no cascades, nothing inferred. */
export async function deleteRows(
  db: SupabaseClient,
  rows: { table: string; key: string; id: string }[],
): Promise<void> {
  for (const { table, key, id } of rows) {
    const { error } = await db.from(table).delete().eq(key, id);
    if (error) throw new Error(`deleting ${table} ${id}: ${error.message}`);
  }
}
