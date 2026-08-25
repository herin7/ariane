import { loadLiveGraph } from "@ariane/core/server";
import { Suspense } from "react";
import { GraphExplorer } from "./explorer";

export const metadata = { title: "How Ariane figured this out" };

export const revalidate = 60;

export default async function GraphPage() {
  // Read the goals off the graph rather than listing them here, so a new
  // journey shows up the moment it is seeded.
  const goals = (await loadLiveGraph()).nodes
    .filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The explorer reads ?goal= so a journey can deep link into its own picture,
  // and useSearchParams needs a boundary on a page this statically rendered.
  return (
    <Suspense fallback={<p className="muted">Loading</p>}>
      <GraphExplorer goals={goals} />
    </Suspense>
  );
}
