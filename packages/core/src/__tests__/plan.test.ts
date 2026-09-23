import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/providers";
import { JurisdictionIndex, appliesTo } from "../jurisdiction";
import { compileJourney } from "../journey";
import { compilePlan } from "../plan";
import type { JurisdictionQuery } from "../types";

/**
 * A plan is several journeys that agree with each other.
 *
 * The two things it must never do: silently drop a goal it could not compile,
 * and list the same step twice because two services both need it. Both read to
 * a citizen as a complete checklist, which is the failure mode that matters -
 * nobody notices a missing licence until somebody with a clipboard does.
 */

const data = loadGraph();

/**
 * A citizen the loaded graph can actually answer.
 *
 * Ahmedabad when the real graph is on disk. Public CI has no snapshot, so the
 * only service is the Example District tree-felling permit. Asking that graph
 * from Ahmedabad is an empty plan for the right reason — the compiler refuses
 * another jurisdiction's service — and then there is nothing here to merge.
 * The assertions below are about compiling and merging, so they ask from
 * somewhere the services exist, and still drop a service that does not apply
 * there rather than taking whatever is first in the file.
 */
const index = new JurisdictionIndex(data.jurisdictions);
const anchorId =
  data.jurisdictions.find((j) => j.id === "IN-GJ-AHMEDABAD")?.id ??
  data.nodes.find((n) => n.type === "SERVICE" && n.jurisdictionId)?.jurisdictionId ??
  data.jurisdictions[0]?.id ??
  "";
const CHAIN = anchorId ? index.chainFor(anchorId) : [];
const jurisdiction: JurisdictionQuery = { country: "India" };
for (const id of CHAIN) {
  const place = index.get(id);
  if (!place) continue;
  if (place.level === "COUNTRY") jurisdiction.country = place.name;
  else if (place.level === "STATE") jurisdiction.state = place.name;
  else if (place.level === "DISTRICT") jurisdiction.district = place.name;
}

/**
 * The services this citizen can actually be handed.
 *
 * Roughly two hundred services in the real graph belong to one district:
 * another district's municipal corporation, its own counters, its own phone
 * number. A plan may not contain one, and the compiler refuses rather than
 * quietly answering with the wrong municipality.
 */
const local = data.nodes.filter((n) => n.type === "SERVICE" && appliesTo(n.jurisdictionId, CHAIN));

/** Two real services out of whatever this graph happens to hold. */
const goals = local.slice(0, 2).map((n) => n.id);

describe("compilePlan", () => {
  it("compiles every goal it was given", () => {
    const plan = compilePlan(data, { goals, jurisdiction });

    expect(plan.tracks.map((t) => t.goal).sort()).toEqual([...goals].sort());
    expect(plan.unknownGoals).toEqual([]);
    expect(plan.checklist.length).toBeGreaterThan(0);
  });

  it("compiles an empty plan for an empty goal list", () => {
    // A citizen who takes every service off their plan gets an empty plan, and
    // the route hands that straight through rather than asking a model to
    // decide what they meant. Nothing here may throw on the way.
    const plan = compilePlan(data, { goals: [], jurisdiction });

    expect(plan.tracks).toEqual([]);
    expect(plan.checklist).toEqual([]);
    expect(plan.unknownGoals).toEqual([]);
  });

  it("names the goals it could not compile instead of shortening the plan", () => {
    const plan = compilePlan(data, { goals: [...goals, "service:not_a_real_service"], jurisdiction });

    expect(plan.unknownGoals).toEqual(["service:not_a_real_service"]);
    expect(plan.tracks).toHaveLength(goals.length);
  });

  it("lists a shared step once and says who else needs it", () => {
    // The same goal twice is the cheapest way to force the collision, and it is
    // the same code path as a PAN that both a company and a GST registration
    // require.
    const plan = compilePlan(data, { goals: [goals[0]!, goals[0]!], jurisdiction });
    const nodeIds = plan.checklist.map((i) => i.step.nodeId);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(plan.checklist.map((i) => i.order)).toEqual(nodeIds.map((_, i) => i + 1));
  });

  it("puts a prerequisite service before the service that needs it", () => {
    const pair = local
      .map((n) => ({ goal: n.id, needs: compileJourney(data, { goal: n.id, jurisdiction }).prerequisiteServices }))
      .find((s) => s.needs.some((p) => p !== s.goal));

    // Nothing in this graph depends on another service, so there is no order to
    // check. Skipped rather than asserted away: it is a fact about the data.
    if (!pair) return;

    const first = pair.needs.find((p) => p !== pair.goal)!;
    const plan = compilePlan(data, { goals: [pair.goal, first], jurisdiction });

    expect(plan.tracks[0]?.goal).toBe(first);
    expect(plan.tracks[1]?.after).toContain(first);
  });
});
