import { supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading the telemetry tables, for the admin panel only.
 *
 * §13. Those tables have RLS on and no policies, so this is the only credential
 * that can see them and it exists only on this side of the wire. Every function
 * here is called from a Server Component or an API route that has already
 * called `requireAdmin` — the browser gets rendered HTML, never a query and
 * never a key.
 *
 * §12: everything pages. `count: "exact", head: false` gives the total for the
 * pager in the same round trip as the rows, so no page here can ever ask for
 * the whole table.
 *
 * Not a route.
 */

export const PAGE_SIZE = 50;

let cached: SupabaseClient | undefined;

/** The service-role client, or undefined on a deployment with no database. */
export function adminDb(): SupabaseClient | undefined {
  if (!cached) {
    const config = supabaseConfigFromEnv();
    if (!config) return undefined;
    cached = supabaseClient(config);
  }
  return cached;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
}

const empty = <T,>(page = 0): Page<T> => ({ rows: [], total: 0, page, pages: 1 });

/**
 * One paged select. `filters` is applied before the range, so the count is the
 * count of what matched rather than of the table.
 */
export async function page<T>(
  table: string,
  options: {
    page?: number;
    order?: string;
    ascending?: boolean;
    select?: string;
    size?: number;
    filters?: Record<string, string | undefined>;
  } = {},
): Promise<Page<T>> {
  const db = adminDb();
  const at = Math.max(0, options.page ?? 0);
  if (!db) return empty<T>(at);

  const size = options.size ?? PAGE_SIZE;
  let query = db
    .from(table)
    .select(options.select ?? "*", { count: "exact" })
    .order(options.order ?? "created_at", { ascending: options.ascending ?? false })
    .range(at * size, at * size + size - 1);

  for (const [column, value] of Object.entries(options.filters ?? {})) {
    if (value) query = query.eq(column, value);
  }

  const { data, count, error } = await query;
  // A missing table on a deployment that has not run the migration is an empty
  // page, not a 500 in an operator's face.
  if (error) return empty<T>(at);
  return { rows: (data ?? []) as T[], total: count ?? 0, page: at, pages: Math.max(1, Math.ceil((count ?? 0) / size)) };
}

/** How many rows in `table` since `sinceMs` ago. One number, no rows fetched. */
export async function countSince(table: string, sinceMs: number, filters: Record<string, string> = {}): Promise<number> {
  const db = adminDb();
  if (!db) return 0;
  let query = db
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query;
  return error ? 0 : (count ?? 0);
}

/**
 * A day-by-day histogram of one table, built in JavaScript from the timestamps.
 *
 * ponytail: reads the last `days` of one column and buckets it here rather than
 * adding a SQL view. Fine at Ariane's volume and honest about its ceiling —
 * move to a `date_trunc` aggregate or a materialised view when a day's traffic
 * stops fitting in one 10k-row read.
 */
export async function daily(table: string, days = 14, column = "created_at"): Promise<{ day: string; count: number }[]> {
  const db = adminDb();
  const start = new Date(Date.now() - days * 86_400_000);
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    buckets.set(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  if (!db) return [...buckets].map(([day, count]) => ({ day, count }));

  const { data, error } = await db
    .from(table)
    .select(column)
    .gte(column, start.toISOString())
    .order(column, { ascending: true })
    .limit(10_000);

  if (!error) {
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const day = String(row[column] ?? "").slice(0, 10);
      if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
  }
  return [...buckets].map(([day, count]) => ({ day, count }));
}

/** `event_name -> count` over the window, for the traction page. §16. */
export async function eventTotals(sinceMs: number): Promise<{ name: string; count: number }[]> {
  const db = adminDb();
  if (!db) return [];
  const { data, error } = await db
    .from("app_events")
    .select("event_name")
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString())
    .limit(20_000);
  if (error) return [];

  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    const name = String((row as { event_name?: string }).event_name ?? "");
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  return [...totals].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
