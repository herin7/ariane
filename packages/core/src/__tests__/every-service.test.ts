import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { compileJourney } from "../journey";

/**
 * Every service in the graph, compiled cold with no answers and nothing held.
 *
 * The per journey files test what the advice says. This one tests that advice
 * comes out at all. A service reachable from search but broken on arrival is
 * the worst failure mode we have, because the citizen has already trusted us
 * by the time it happens, and no other test covers the twenty odd services
 * that are not the five headline journeys.
 */

const data = loadGraph();
const services = data.nodes.filter((n) => n.type === "SERVICE");

const compile = (goal: string) =>
  compileJourney(data, {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
  });

describe("every service compiles into something a citizen can act on", () => {
  it("has services to compile in the first place", () => {
    expect(services.length).toBeGreaterThan(20);
  });

  for (const service of services) {
    it(`${service.id} compiles`, () => {
      const journey = compile(service.id);

      // Nothing may arrive empty. An empty path is a dead end wearing a page.
      expect(journey.orderedSteps.length).toBeGreaterThan(0);
      expect(journey.goalName).toBeTruthy();

      // §15. If we cannot cite it we do not print it.
      for (const step of journey.orderedSteps) expect(step.sources.length).toBeGreaterThan(0);

      // Steps are numbered from one with no gaps, because the citizen reads
      // them as instructions and skipping four is not an instruction.
      expect(journey.orderedSteps.map((s) => s.order)).toEqual(
        journey.orderedSteps.map((_, i) => i + 1),
      );

      // A blocker held by someone else must say who, or it is just bad news.
      for (const blocker of journey.blockers) {
        expect(blocker.actor).toBeTruthy();
        expect(blocker.reason).toBeTruthy();
      }

      // A derived question nobody can answer is a dead end too.
      for (const question of journey.outstandingQuestions) {
        expect(question.label).toBeTruthy();
        if (question.inputType === "SINGLE_SELECT") expect(question.options?.length).toBeGreaterThan(0);
      }
    });
  }
});
