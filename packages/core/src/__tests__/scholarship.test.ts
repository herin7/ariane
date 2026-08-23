import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { compileJourney } from "../journey";
import type { CitizenContext, CompiledJourney } from "../types";

/**
 * The cross journey test, and the reason this thing is called a compiler.
 *
 * Nowhere in scholarship.ts does anyone write down the steps for getting an
 * income certificate. It requires `document:income_certificate`, the
 * certificates graph produces that document, and the compiler works out the
 * rest. If that ever stops being true these tests go red and the product goes
 * back to being a checklist.
 */

const data = loadGraph();

const compile = (citizen?: CitizenContext, goal = "scholarship"): CompiledJourney =>
  compileJourney(data, {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
    citizen,
  });

const stepIds = (j: CompiledJourney) => j.orderedSteps.map((s) => s.nodeId);
const at = (j: CompiledJourney, id: string) => stepIds(j).indexOf(id);
const before = (j: CompiledJourney, a: string, b: string) => at(j, a) < at(j, b) && at(j, a) >= 0;

const FRESH_SC: CitizenContext = { answers: { application_type: "fresh", category: "sc" } };

describe("asking for a scholarship pulls the certificate journeys in underneath it", () => {
  const j = compile(FRESH_SC);

  it("puts the whole income certificate journey in the path, unasked", () => {
    expect(stepIds(j)).toContain("service:income_certificate");
    expect(stepIds(j)).toContain("verification:talati_hearing");
  });

  it("orders both certificates before the application that needs them", () => {
    expect(before(j, "service:income_certificate", "service:nsp_scholarship")).toBe(true);
    expect(before(j, "service:caste_certificate", "service:nsp_scholarship")).toBe(true);
  });

  it("keeps the certificate journey's own internal order intact", () => {
    expect(before(j, "verification:talati_hearing", "service:income_certificate")).toBe(true);
  });

  it("registers before it applies", () => {
    expect(before(j, "service:nsp_otr", "service:nsp_scholarship")).toBe(true);
  });

  it("does this without either file naming the other", () => {
    // The only thing joining them is the document id. If someone ever hard
    // codes a link between the two journeys, this is the test that should have
    // caught it.
    const link = data.edges.find(
      (e) => e.from === "service:nsp_scholarship" && e.to === "document:income_certificate",
    );
    expect(link?.type).toBe("REQUIRES");
    const produced = data.edges.find(
      (e) => e.to === "document:income_certificate" && e.type === "PRODUCES",
    );
    expect(produced?.from).toBe("service:income_certificate");
  });
});

describe("the path shrinks when the citizen does not need the certificates", () => {
  const renewal = compile({ answers: { application_type: "renewal", category: "general" } });

  it("drops the income certificate for a renewal, because the portal does not ask renewers for one", () => {
    expect(stepIds(renewal)).not.toContain("service:income_certificate");
    expect(stepIds(renewal)).not.toContain("verification:talati_hearing");
  });

  it("drops the caste certificate for a general category student", () => {
    expect(stepIds(renewal)).not.toContain("service:caste_certificate");
  });

  it("is a materially shorter journey, not the same list with items greyed out", () => {
    expect(renewal.summary.stepsRemaining).toBeLessThan(compile(FRESH_SC).summary.stepsRemaining);
  });

  it("still gets the student to the scholarship, and past it", () => {
    // The application is not the finish line. Two verifications happen after
    // it and the student is told about both, because an application nobody
    // verifies is an application nobody paid.
    expect(stepIds(renewal)).toContain("service:nsp_scholarship");
    expect(stepIds(renewal).at(-1)).toBe("verification:nsp_ministry");
  });
});

describe("holding a certificate collapses the branch that produces it", () => {
  it("stops telling you to see the Talati once you already have the certificate", () => {
    const held = compile({
      answers: { application_type: "fresh", category: "sc" },
      documents: ["document:income_certificate"],
    });
    expect(stepIds(held)).not.toContain("service:income_certificate");
    expect(stepIds(held)).not.toContain("verification:talati_hearing");
    expect(stepIds(held)).toContain("service:caste_certificate");
  });
});

describe("the parts of a scholarship nobody else can do for you", () => {
  const j = compile(FRESH_SC);

  it("names the institute, the bank and the ministry as the ones who have to move", () => {
    const actors = new Set(j.blockers.map((b) => b.actor));
    expect(actors).toContain("INSTITUTE");
    expect(actors).toContain("BANK");
    expect(actors).toContain("GOVERNMENT");
  });

  it("warns that an unverified application counts as never having applied", () => {
    const verify = j.blockers.find((b) => b.nodeId === "verification:nsp_institute");
    expect(verify?.reason).toMatch(/invalid/i);
  });

  it("says the money lands in the Aadhaar seeded account and nowhere else", () => {
    const seeding = j.blockers.find((b) => b.actor === "BANK");
    expect(seeding?.sources.length).toBeGreaterThan(0);
    expect(`${seeding?.reason}`).toMatch(/aadhaar seeded/i);
  });
});

describe("two government pages disagree about applying for more than one scheme", () => {
  it("keeps both and disqualifies nobody", () => {
    const conflicting = data.edges.filter(
      (e) => e.verificationStatus === "CONFLICTING" && e.from.startsWith("service:nsp"),
    );
    expect(conflicting.length).toBeGreaterThanOrEqual(2);
    for (const edge of conflicting) {
      expect(edge.note, `${edge.id} needs a note telling the student what to do`).toBeTruthy();
      for (const source of edge.sources ?? []) expect(source.evidence?.length ?? 0).toBeGreaterThan(0);
      // Neither side may carry a rule, or one of them silently wins.
      const target = data.nodes.find((n) => n.id === edge.to);
      expect(target?.metadata?.rule).toBeUndefined();
    }
  });

  it("nothing in the compiled journey is blocked by the disagreement", () => {
    const j = compile(FRESH_SC);
    const fromConflict = j.blockers.filter((b) => b.nodeId.includes("scheme"));
    expect(fromConflict).toEqual([]);
  });
});

describe("the questions asked are the ones that change the answer", () => {
  it("asks about application type and category before it knows them", () => {
    const fields = compile().outstandingQuestions.map((q) => q.field);
    expect(fields).toContain("application_type");
    expect(fields).toContain("category");
  });

  it("stops asking once told, and asks nothing that no longer matters", () => {
    const fields = compile(FRESH_SC).outstandingQuestions.map((q) => q.field);
    expect(fields).not.toContain("application_type");
    expect(fields).not.toContain("category");
  });

  it("explains what each remaining question would change", () => {
    for (const q of compile(FRESH_SC).outstandingQuestions) {
      expect(q.affects.length).toBeGreaterThan(0);
      expect(q.label.length).toBeGreaterThan(0);
    }
  });
});
