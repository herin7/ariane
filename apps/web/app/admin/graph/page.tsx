import { loadLiveGraph } from "@ariane/core/server";
import { GraphExplorer } from "./explorer";

export const metadata = { title: "Graph explorer" };

export const revalidate = 60;

export default async function GraphPage() {
  // Read the goals off the graph rather than listing them here, so a new
  // journey shows up the moment it is seeded.
  const goals = (await loadLiveGraph()).nodes
    .filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name }));

  return <GraphExplorer goals={goals} />;
}
