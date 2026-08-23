import { loadGraph } from "@ariane/core";
import { GraphExplorer } from "./explorer";

export const metadata = { title: "Graph explorer" };

export default function GraphPage() {
  // Read the goals off the graph rather than listing them here, so a new
  // journey shows up the moment it is seeded.
  const goals = loadGraph()
    .nodes.filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name }));

  return <GraphExplorer goals={goals} />;
}
