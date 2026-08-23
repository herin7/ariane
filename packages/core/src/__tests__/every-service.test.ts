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

      // Whether a person read the page has to survive the compile.
      //
      // It did not. The compiler wrote `machineExtracted` onto 189 of 217
      // service nodes, `db:push` carried it, and no screen ever asked for it,
      // so a machine's reading and a researcher's reading arrived in the same
      // typeface. A field written by one side and read by nobody is how that
      // happens, and this is the line that notices next time.
      const step = journey.orderedSteps.find((s) => s.nodeId === service.id);
      if (step) expect(Boolean(step.machineExtracted)).toBe(Boolean(service.metadata?.machineExtracted));
    });
  }
});

/**
 * A generated service may not take a name a hand written one already answers to.
 *
 * `resolveGoal` tries `service:<slug of what you typed>` before it scans
 * aliases, so an id nobody declared is still load bearing. `scholarship.json`
 * has no `service:scholarship` node; it answers to that word because it is an
 * alias of `service:nsp_scholarship`. The first machine compile minted a
 * `service:scholarship` off a Rajkot listing page, that id won the earlier
 * candidate, and the entire scholarship journey compiled to one step while
 * every gate stayed green.
 *
 * The compiler now reserves these ids. This is the test that says so, because
 * the reservation lives in a script that only runs when someone re-crawls, and
 * a guarantee nobody checks is a guarantee until the day it is not.
 */
describe("the machine cannot shadow a hand written service", () => {
  const handWritten = services.filter((s) => !s.metadata?.machineExtracted);

  it("found the hand written services", () => {
    expect(handWritten.length).toBeGreaterThan(20);
  });

  for (const service of handWritten) {
    const phrases = [service.name, service.officialName, ...(service.aliases ?? [])].filter(
      (p): p is string => Boolean(p),
    );
    for (const phrase of phrases) {
      it(`"${phrase}" still resolves to a hand written service`, () => {
        // Not to *this* service. "sebc certificate" is the name of one hand
        // written service and an alias of another, and which one wins is an
        // overlap two people left in the seed, not a thing the machine broke.
        // What must never happen is a machine extracted service answering.
        const winner = data.nodes.find((n) => n.id === compile(phrase).goal);
        expect(winner?.metadata?.machineExtracted).toBeFalsy();
      });
    }
  }
});
