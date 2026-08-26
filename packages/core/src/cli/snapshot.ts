import { loadGraph } from "../data/providers";
import { compileJourney } from "../journey";

/**
 * A fingerprint of what the compiler currently answers, for every service.
 *
 *   pnpm graph:snapshot > /tmp/before.txt
 *   ...change something structural...
 *   pnpm graph:snapshot | diff /tmp/before.txt -
 *
 * Bundle load order, requirement group edits and edge reshuffles are all things
 * that pass every test and quietly change what a citizen is told to do first.
 * This is the cheapest way to see that happen. One line per service, tab
 * separated, stable ordering, so `diff` is the whole tool.
 */

const g = loadGraph();
const services = g.nodes.filter((n) => n.type === "SERVICE").sort((a, b) => a.id.localeCompare(b.id));

for (const s of services) {
  const j = compileJourney(g, { goal: s.id, jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" } });
  console.log(
    [
      s.id,
      j.orderedSteps.map((x) => x.nodeId).join(">"),
      `docs:${j.documentsNeeded.length}`,
      `blockers:${j.blockers.length}`,
      `q:${j.outstandingQuestions.map((q) => q.field).join(",")}`,
      `src:${j.sources.length}`,
    ].join("\t"),
  );
}
console.error(`${services.length} services, ${g.nodes.length} nodes, ${g.edges.length} edges`);
