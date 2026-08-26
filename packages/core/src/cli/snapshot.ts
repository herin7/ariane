import { loadGraph } from "../data/providers";
import { compileJourney } from "../journey";

/**
 * A fingerprint of what the compiler currently answers, for every service.
 *
 *   pnpm graph:snapshot > /tmp/before.txt
 *   ...change something structural...
 *   pnpm graph:snapshot | diff /tmp/before.txt -
 *
 * Or against two snapshot directories, which is how a Supabase push is checked
 * for collateral damage before anyone trusts it:
 *
 *   ARIANE_GRAPH_DIR=/tmp/pull-before pnpm graph:snapshot > /tmp/before.txt
 *   ARIANE_GRAPH_DIR=/tmp/pull-after  pnpm graph:snapshot | diff /tmp/before.txt -
 *
 * Bundle load order, requirement group edits and edge reshuffles are all things
 * that pass every test and quietly change what a citizen is told to do first.
 * This is the cheapest way to see that happen. One line per service, tab
 * separated, stable ordering, so `diff` is the whole tool.
 *
 * It used to print counts — `docs:7`, `src:3` — which is enough to catch a
 * document disappearing and useless against a phone number changing, an office
 * losing the coordinate its map pin is drawn from, or a citation keeping its id
 * while the sentence underneath it is replaced. Those are the regressions worth
 * being afraid of, so the fields are spelled out instead of counted.
 */

const g = loadGraph();
const services = g.nodes.filter((n) => n.type === "SERVICE").sort((a, b) => a.id.localeCompare(b.id));

/** `via` and the phone numbers, because a helpline with no number is furniture. */
const channel = (c: { nodeId: string; channelType: string; url?: string; phoneNumbers?: string[]; via: string }) =>
  [c.nodeId, c.channelType, c.url ?? "", (c.phoneNumbers ?? []).join(" "), c.via].join("~");

let offices = 0;
let placed = 0;

for (const s of services) {
  const j = compileJourney(g, { goal: s.id, jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" } });
  offices += j.offices.length;
  placed += j.offices.filter((o) => o.location).length;
  console.log(
    [
      s.id,
      j.orderedSteps.map((x) => x.nodeId).join(">"),
      `docs:${j.documentsNeeded.map((d) => d.nodeId).sort().join(",")}`,
      `blockers:${j.blockers.map((b) => b.nodeId).sort().join(",")}`,
      `q:${j.outstandingQuestions.map((q) => q.field).join(",")}`,
      // Published coordinate, then the geocoder's. Never merged, so never
      // merged here either: a pin moving from one to the other is a change.
      `offices:${j.offices
        .map((o) =>
          [
            o.nodeId,
            o.address ?? "",
            (o.phoneNumbers ?? []).join(" "),
            o.workingHours ?? "",
            o.latitude !== undefined ? `${o.latitude},${o.longitude}` : "",
            o.location ? `${o.location.status}:${o.location.latitude},${o.location.longitude}` : "",
          ].join("~"),
        )
        .sort()
        .join(";")}`,
      `helplines:${j.helplines.map(channel).sort().join(";")}`,
      `channels:${[...j.digitalChannels, ...j.mobileApps, ...j.escalationPaths].map(channel).sort().join(";")}`,
      // The quote, not just the id. A citation that keeps its id and swaps the
      // sentence underneath it is the failure this whole line exists to catch.
      `src:${j.sources.map((r) => `${r.sourceId}~${r.source.url}~${r.source.sourceType}~${r.evidence ?? ""}`).sort().join(";")}`,
    ].join("\t"),
  );
}
console.error(
  `${services.length} services, ${g.nodes.length} nodes, ${g.edges.length} edges, ` +
    `${offices} office reference(s) of which ${placed} carry a coordinate`,
);
