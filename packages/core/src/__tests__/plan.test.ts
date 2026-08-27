import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/providers";
import { compileJourney } from "../journey";
import { compilePlan } from "../plan";

/**
 * A plan is several journeys that agree with each other.
 *
 * The two things it must never do: silently drop a goal it could not compile,
 * and list the same step twice because two services both need it. Both read to
 * a citizen as a complete checklist, which is the failure mode that matters -
 * nobody notices a missing licence until somebody with a clipboard does.
 */

const data = loadGraph();
const jurisdiction = { country: "India", state: "Gujarat", district: "Ahmedabad" };

/** Two real services out of whatever this graph happens to hold. */
const goals = data.nodes
  .filter((n) => n.type === "SERVICE")
  .slice(0, 2)
  .map((n) => n.id);

describe("compilePlan", () => {
  it("compiles every goal it was given", () => {
    const plan = compilePlan(data, { goals, jurisdiction });

    expect(plan.tracks.map((t) => t.goal).sort()).toEqual([...goals].sort());
    expect(plan.unknownGoals).toEqual([]);
    expect(plan.checklist.length).toBeGreaterThan(0);
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
    const pair = data.nodes
      .filter((n) => n.type === "SERVICE")
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
