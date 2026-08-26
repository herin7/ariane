import { canPrerender, loadLiveGraph } from "@ariane/core/server";
import { connection } from "next/server";

/**
 * The graph, for a page, with one thing checked first.
 *
 * A prerendered page is rows frozen into HTML and shipped inside the build
 * artifact. Real rows belong there and are why `/` is fast. `fixtures/demo` is
 * four invented nodes about a tree felling permit, and once it is baked into
 * `/`, `/browse` and `/journey` nothing asks again: the refusal in
 * `loadLiveGraph` never runs, because the answer was written at build time.
 *
 * So a build with no credentials and no snapshot renders these pages per
 * request instead. `connection()` is the documented way to say that from
 * inside a component, which matters because Next only reads `export const
 * dynamic` as a literal and this decision is not knowable when the file is
 * parsed.
 *
 * With Supabase configured or a snapshot on disk — which is every deploy and
 * every maintainer's laptop — this is a no-op and the pages prerender exactly
 * as they did before.
 */
export async function graph() {
  if (!canPrerender()) await connection();
  return loadLiveGraph();
}
