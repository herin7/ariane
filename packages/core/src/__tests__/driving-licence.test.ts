import { describe, expect, it } from "vitest";
import { loadGraph, validateGraph } from "../data/index";
import { GoalNotFoundError, compileJourney } from "../journey";
import type { CitizenContext, CompiledJourney } from "../types";

/**
 * The checkpoint the whole engine is graded against. These assert citizen
 * outcomes, not internals: what am I told to do, in what order, and does it
 * change when I say I already have something.
 */

const data = loadGraph();

const compile = (citizen?: CitizenContext, district = "Ahmedabad"): CompiledJourney =>
  compileJourney(data, {
    goal: "driving_licence",
    jurisdiction: { country: "India", state: "Gujarat", district },
    citizen,
  });

const stepIds = (j: CompiledJourney) => j.orderedSteps.map((s) => s.nodeId);
const before = (j: CompiledJourney, a: string, b: string) => stepIds(j).indexOf(a) < stepIds(j).indexOf(b);

describe("seed data", () => {
  it("has no integrity errors", () => {
    expect(validateGraph(data).filter((i) => i.severity === "ERROR")).toEqual([]);
  });

  it("has no warnings either, so nothing is quietly unsourced", () => {
    expect(validateGraph(data).filter((i) => i.severity === "WARNING")).toEqual([]);
  });
});

describe("goal resolution", () => {
  it("accepts the bare key, the namespaced id, an alias and the display name", () => {
    for (const goal of ["driving_licence", "service:driving_licence", "dl", "Driving licence"]) {
      expect(
        compileJourney(data, { goal, jurisdiction: { country: "India", state: "Gujarat" } }).goal,
      ).toBe("service:driving_licence");
    }
  });

  it("refuses to guess when nothing matches", () => {
    expect(() =>
      compileJourney(data, { goal: "a pony", jurisdiction: { country: "India", state: "Gujarat" } }),
    ).toThrow(GoalNotFoundError);
  });
});

describe("a Gujarat citizen starting from nothing", () => {
  const j = compile();

  it("compiles without warnings or cycles", () => {
    expect(j.warnings).toEqual([]);
  });

  it("resolves the jurisdiction down to the district", () => {
    expect(j.jurisdiction.chain).toEqual(["IN-GJ-AHMEDABAD", "IN-GJ", "IN"]);
  });

  it("asks only the three questions that actually change the graph", () => {
    expect(j.outstandingQuestions.map((q) => q.field).sort()).toEqual([
      "age",
      "learner_licence_days",
      "vehicle_class",
    ]);
  });

  it("explains what each question would change", () => {
    const age = j.outstandingQuestions.find((q) => q.field === "age");
    expect(age?.affects).toContain("document:form_1a_medical");
    expect(age?.label).toBe("How old are you?");
  });

  it("tells you to get the learner's licence before the driving licence", () => {
    expect(before(j, "service:learner_licence", "service:driving_licence")).toBe(true);
  });

  it("tells you to pay before you turn up at the RTO with a fee receipt", () => {
    expect(before(j, "payment:learner_licence_fee", "action:visit_rto_verification")).toBe(true);
  });

  it("does not send you to the driving test before the learner's licence exists", () => {
    expect(before(j, "service:learner_licence", "action:driving_test")).toBe(true);
    expect(before(j, "service:learner_licence", "action:book_driving_test_slot")).toBe(true);
  });

  it("names the portal to apply on and the office to visit", () => {
    expect(j.digitalChannels.map((c) => c.url)).toContain("https://sarathi.parivahan.gov.in/sarathiservice/");
    expect(j.offices.map((o) => o.nodeId)).toContain("office:rto");
  });

  it("backs every step with at least one source", () => {
    for (const step of j.orderedSteps) expect(step.sources.length).toBeGreaterThan(0);
  });

  it("quotes the page verbatim on every source it cites", () => {
    for (const source of j.sources) expect(source.evidence?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("questions collapse as they are answered", () => {
  it("answering age removes the age question and decides which medical form applies", () => {
    const young = compile({ answers: { age: 25, vehicle_class: "non_transport" } });
    expect(young.outstandingQuestions.map((q) => q.field)).toEqual(["learner_licence_days"]);

    const needed = young.documentsNeeded.map((d) => d.nodeId);
    expect(needed).toContain("document:form_1_declaration");
  });

  it("at 40 and above you are asked for the medical certificate and not the declaration", () => {
    const older = compile({ answers: { age: 45, vehicle_class: "non_transport" } });
    const needed = older.documentsNeeded.map((d) => d.nodeId);
    expect(needed).toContain("document:form_1a_medical");
    expect(needed).not.toContain("document:form_1_declaration");
  });

  it("keeps both sides of the Form 1A conflict rather than picking one", () => {
    const young = compile({ answers: { age: 25, vehicle_class: "non_transport" } });
    const form1a = young.documentsNeeded.find((d) => d.nodeId === "document:form_1a_medical");
    expect(form1a, "the conflicting source must not be silently dropped").toBeDefined();
    expect(form1a?.note).toMatch(/conflict/i);

    const conflicting = young.graph.edges.filter((e) => e.verificationStatus === "CONFLICTING");
    expect(conflicting).toHaveLength(1);
  });
});

describe("eligibility", () => {
  it("blocks a 16 year old and says who has to act", () => {
    const j = compile({ answers: { age: 16, vehicle_class: "non_transport" } });
    expect(j.summary.blockerCount).toBe(1);
    const blocker = j.blockers[0];
    expect(blocker?.nodeId).toBe("eligibility:age_18_non_transport");
    expect(blocker?.actor).toBe("CITIZEN");
    expect(blocker?.sources.length).toBeGreaterThan(0);
  });

  it("applies the 20 year rule instead when the vehicle is a transport one", () => {
    const j = compile({ answers: { age: 19, vehicle_class: "transport" } });
    expect(j.nodeStates["eligibility:age_20_transport"]).toBe("BLOCKED");
    expect(j.nodeStates["eligibility:age_18_non_transport"]).toBeUndefined();
  });

  it("lets a 19 year old through for a private vehicle", () => {
    const j = compile({ answers: { age: 19, vehicle_class: "non_transport" } });
    expect(j.summary.blockerCount).toBe(0);
    expect(j.nodeStates["eligibility:age_18_non_transport"]).toBe("SATISFIED");
  });
});

describe("satisfaction pruning", () => {
  const held = compile({
    documents: ["document:learner_licence"],
    answers: { age: 25, vehicle_class: "non_transport", learner_licence_days: 45 },
  });

  it("drops the whole learner's licence branch once you hold it", () => {
    expect(stepIds(held)).not.toContain("service:learner_licence");
    expect(stepIds(held)).not.toContain("action:visit_rto_verification");
    expect(stepIds(held)).not.toContain("payment:learner_licence_fee");
  });

  it("stops asking for documents that only the dropped branch needed", () => {
    expect(held.documentsNeeded.map((d) => d.nodeId)).not.toContain("document_group:address_and_age_proof");
    expect(held.summary.documentsToPrepareCount).toBe(0);
  });

  it("still gets you to the driving licence, with fewer steps", () => {
    expect(stepIds(held)).toEqual([
      "payment:driving_licence_fee",
      "action:book_driving_test_slot",
      "action:driving_test",
      "service:driving_licence",
    ]);
    expect(held.summary.stepsRemaining).toBeLessThan(compile().summary.stepsRemaining);
  });

  it("resolves a document named the way a citizen would say it", () => {
    const loose = compile({ documents: ["learner's licence"], answers: { age: 25, vehicle_class: "non_transport" } });
    expect(stepIds(loose)).not.toContain("service:learner_licence");
  });

  it("shows an ANY_OF proof as satisfied when you hold one of the alternatives", () => {
    const j = compile({ documents: ["document:passport"], answers: { age: 25, vehicle_class: "non_transport" } });
    expect(j.documentsNeeded.map((d) => d.nodeId)).not.toContain("document_group:address_and_age_proof");
    expect(j.documentsReady.map((d) => d.nodeId)).toContain("document_group:address_and_age_proof");
  });

  it("renders the proof as a choice, not as a pile of mandatory documents", () => {
    const proof = compile().documentsNeeded.find((d) => d.nodeId === "document_group:address_and_age_proof");
    expect(proof?.mode).toBe("ANY_OF");
    expect(proof?.minimumRequired).toBe(1);
    expect(proof?.alternatives?.map((a) => a.nodeId)).toEqual(["document:passport", "document:birth_certificate"]);
  });
});

describe("output shape", () => {
  const j = compile({ answers: { age: 25, vehicle_class: "non_transport", learner_licence_days: 45 } });

  it("returns only the reachable slice of the graph, never the whole thing", () => {
    expect(j.graph.nodes.length).toBeLessThan(data.nodes.length);
    const ids = new Set(j.graph.nodes.map((n) => n.id));
    for (const edge of j.graph.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });

  it("carries a trace that explains how the path was produced", () => {
    expect(j.trace.map((t) => t.stage)).toContain("Expand dependencies");
    expect(j.trace.map((t) => t.stage)).toContain("Topological ordering");
  });

  it("numbers the steps from one, in order, with no gaps", () => {
    expect(j.orderedSteps.map((s) => s.order)).toEqual(j.orderedSteps.map((_, i) => i + 1));
  });

  it("says which service produces the learner's licence it is asking for", () => {
    const ll = compile().documentsNeeded.find((d) => d.nodeId === "document:learner_licence");
    expect(ll?.producedByServiceId).toBe("service:learner_licence");
  });

  it("is deterministic, the same request twice gives the same path", () => {
    expect(stepIds(compile())).toEqual(stepIds(compile()));
  });

  it("gives the same national path when only the state is known", () => {
    const district = compile(undefined, "Ahmedabad");
    const state = compileJourney(data, {
      goal: "driving_licence",
      jurisdiction: { country: "India", state: "Gujarat" },
    });
    expect(stepIds(state)).toEqual(stepIds(district));
  });
});
