import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { compileJourney, stageGroups } from "../journey";
import type { CompiledJourney } from "../types";

/**
 * Our grouping is not allowed to reorder somebody else's numbering.
 *
 * Found by screenshotting the driving licence journey on a 430px phone and
 * reading it: the steps under "Apply" ran 1, 2, 4, 5, 6, 7, 8, and step 3 was
 * in a section further down. Nothing on the screen was false. It still showed a
 * citizen a government's own numbered instructions with a number missing from
 * them, which reads as a bug in the government rather than a choice by us.
 */

const data = loadGraph();

const compile = (goal: string): CompiledJourney =>
  compileJourney(data, { goal, jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" } });

describe("stageGroups", () => {
  it("goes flat when grouping would break a published sequence", () => {
    const journey = compile("driving_licence");
    const groups = stageGroups(journey.orderedSteps);

    // parivahan numbers this journey 1 to 8 and step 3, the one visit to the
    // RTO, is the only one that lands in AFTER_SUBMISSION.
    expect(journey.orderedSteps.filter((s) => s.orderVerified).length).toBeGreaterThan(5);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.stage).toBeNull();
    expect(groups[0]?.steps).toHaveLength(journey.orderedSteps.length);
  });

  it("still groups by stage when nobody published an order", () => {
    // 517 of 553 services are this case, and for them "Get these ready" over
    // the documents is real information rather than an invented sequence.
    const grouped = data.nodes
      .filter((n) => n.type === "SERVICE")
      .map((n) => n.id.replace(/^service:/, ""))
      .map((goal) => {
        try {
          return stageGroups(compile(goal).orderedSteps);
        } catch {
          return null;
        }
      })
      .filter((g) => g && g.length > 1);

    expect(grouped.length).toBeGreaterThan(0);
  });

  it("never drops or duplicates a step, whichever shape it picks", () => {
    for (const goal of ["driving_licence", "nsp_scholarship", "income_certificate", "domicile_certificate"]) {
      const steps = compile(goal).orderedSteps;
      const flattened = stageGroups(steps).flatMap((g) => g.steps);
      expect(new Set(flattened.map((s) => s.nodeId)).size).toBe(steps.length);
      expect(flattened).toHaveLength(steps.length);
    }
  });

  it("leaves every published number ascending in whatever order it renders", () => {
    // The invariant, stated once and checked against the whole catalogue rather
    // than against the one journey that caught it.
    for (const node of data.nodes.filter((n) => n.type === "SERVICE")) {
      let journey: CompiledJourney;
      try {
        journey = compile(node.id.replace(/^service:/, ""));
      } catch {
        continue;
      }
      const published = stageGroups(journey.orderedSteps)
        .flatMap((g) => g.steps)
        .filter((s) => s.orderVerified)
        .map((s) => s.order);
      expect(published, node.id).toEqual([...published].sort((a, b) => a - b));
    }
  });
});
