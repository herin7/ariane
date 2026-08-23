import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { compileJourney } from "../journey";
import { officeLine, type CitizenContext, type CompiledJourney } from "../types";

/**
 * Revenue certificates. These assert what a citizen is told, not how the
 * compiler is built. The point of this suite is that the honest answers stay
 * honest: a district only claim keeps saying it is a district claim, a
 * disagreement between two government pages keeps disagreeing, and a step that
 * nobody but the Talati can move keeps saying so.
 */

const data = loadGraph();

const compile = (goal: string, district = "Ahmedabad", citizen?: CitizenContext): CompiledJourney =>
  compileJourney(data, {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district },
    citizen,
  });

const stepIds = (j: CompiledJourney) => j.orderedSteps.map((s) => s.nodeId);

describe("the three certificates compile", () => {
  for (const [goal, id] of [
    ["income_certificate", "service:income_certificate"],
    ["caste_certificate", "service:caste_certificate"],
    ["domicile_certificate", "service:domicile_certificate"],
  ] as const) {
    it(`${goal} resolves, ends on itself, and cites a page for every step`, () => {
      const j = compile(goal);
      expect(j.goal).toBe(id);
      expect(j.warnings).toEqual([]);
      expect(stepIds(j).at(-1)).toBe(id);
      for (const step of j.orderedSteps) expect(step.sources.length).toBeGreaterThan(0);
      for (const source of j.sources) expect(source.evidence?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe("each certificate hands you a document the rest of the graph can use", () => {
  it("produces the document ids other journeys require", () => {
    const produced = data.edges
      .filter((e) => e.type === "PRODUCES")
      .map((e) => `${e.from}->${e.to}`);
    expect(produced).toContain("service:income_certificate->document:income_certificate");
    expect(produced).toContain("service:caste_certificate->document:caste_certificate");
    expect(produced).toContain("service:domicile_certificate->document:domicile_certificate");
  });

  it("names the service to go and get it, so a dependent journey can link through", () => {
    const j = compile("income_certificate");
    const doc = j.graph.nodes.find((n) => n.id === "document:income_certificate");
    expect(doc).toBeDefined();
  });
});

describe("the Talati report is not a document you can go and fetch", () => {
  const j = compile("income_certificate");

  it("is a blocker that names the government, not the citizen", () => {
    const talati = j.blockers.find((b) => b.nodeId === "verification:talati_hearing");
    expect(talati?.actor).toBe("GOVERNMENT");
    expect(talati?.sources.length).toBeGreaterThan(0);
  });

  it("says once per journey what is blocking, however many steps it holds up", () => {
    // It genuinely holds up two steps and is reported on both of them, which is
    // where a citizen needs to see it. The summary is the answer to "what is
    // stopping me" and that answer is one thing, not two.
    expect(j.blockers.map((b) => b.nodeId)).toEqual(["verification:talati_hearing"]);
    expect(j.summary.blockerCount).toBe(1);
    expect(j.orderedSteps.filter((s) => s.blockers.length).length).toBeGreaterThan(1);
  });

  it("tells you that filing again will not help", () => {
    const talati = j.blockers[0];
    expect(`${talati?.reason} ${talati?.resolution ?? ""}`).toMatch(/again|a second time/i);
  });
});

describe("a district list stays labelled as a district list", () => {
  it("says which district published the documents, and that it is a guide", () => {
    const j = compile("income_certificate");
    const docs = j.documentsNeeded.filter((d) => d.note);
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) expect(d.note).toMatch(/Mahesana|Morbi|Confirm/i);
  });

  it("does not widen a document that was left scoped to its own district", () => {
    const ahmedabad = compile("income_certificate").graph.nodes.map((n) => n.id);
    const mehsana = compile("income_certificate", "Mehsana").graph.nodes.map((n) => n.id);
    expect(mehsana).toContain("document:death_evidence");
    expect(ahmedabad).not.toContain("document:death_evidence");
  });
});

describe("proof is offered as a choice", () => {
  it("renders residence proof as ANY_OF with real alternatives", () => {
    const group = compile("income_certificate").documentsNeeded.find((d) => d.mode === "ANY_OF");
    expect(group?.minimumRequired).toBe(1);
    expect(group?.alternatives?.length).toBeGreaterThan(1);
  });

  it("collapses the group the moment you hold one of the alternatives", () => {
    const plain = compile("income_certificate");
    const group = plain.documentsNeeded.find((d) => d.mode === "ANY_OF");
    const held = compile("income_certificate", "Ahmedabad", {
      documents: [group!.alternatives![0]!.nodeId],
    });
    expect(held.documentsReady.map((d) => d.nodeId)).toContain(group!.nodeId);
    expect(held.documentsNeeded.map((d) => d.nodeId)).not.toContain(group!.nodeId);
  });
});

describe("Ahmedabad publishes two PIN codes for one office", () => {
  it("keeps both rather than picking the one that looks right", () => {
    const office = data.nodes.find((n) => n.id === "office:mamlatdar_ahmedabad");
    const statuses = (office?.sources ?? []).map((s) => s.verificationStatus);
    expect(statuses).toContain("CONFLICTING");
    for (const source of office?.sources ?? []) {
      expect(source.evidence?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("tells the citizen to ring first instead of guessing for them", () => {
    const office = data.nodes.find((n) => n.id === "office:mamlatdar_ahmedabad");
    expect(office?.description).toMatch(/380027/);
    expect(office?.description).toMatch(/380030/);
  });
});

describe("office addresses read like an address", () => {
  it("does not print the office name twice when the address already contains it", () => {
    const office = compile("income_certificate").offices.find(
      (o) => o.nodeId === "office:mamlatdar_ahmedabad",
    );
    expect(officeLine(office!)).toBe("Mamlatdar Office, Jan Seva Kendra, Ahmedabad - 380027");
  });

  it("says an address is missing rather than printing a bare name", () => {
    const office = compile("income_certificate").offices.find((o) => !o.address);
    expect(officeLine(office!)).toMatch(/address not verified yet/);
  });
});

describe("asking for one certificate does not hand you three", () => {
  it("keeps the sibling certificates out of the caste certificate path", () => {
    const ids = stepIds(compile("caste_certificate"));
    expect(ids).not.toContain("service:income_certificate");
    expect(ids).not.toContain("service:domicile_certificate");
  });

  it("does not tell you to get a driving licence first", () => {
    expect(stepIds(compile("caste_certificate"))).not.toContain("service:driving_licence");
  });
});
