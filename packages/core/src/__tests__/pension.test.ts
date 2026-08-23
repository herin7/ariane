import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { resolveIntent } from "../intent";
import { compileJourney } from "../journey";
import * as pension from "../data/journeys/pension";
import type { CitizenContext, CompiledJourney } from "../types";

/**
 * Four official government pages print four different monthly figures for the
 * two central pension schemes. That disagreement is the most important fact
 * this journey has, and the temptation to quietly pick the nicest number, or
 * the newest page, or the average, is exactly the failure this project exists
 * to not commit. These tests are here to make picking one an obvious red test.
 */

const data = loadGraph();

const compile = (goal: string, citizen?: CitizenContext): CompiledJourney =>
  compileJourney(data, {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
    citizen,
  });

const widow: CitizenContext = { answers: { is_widow: true, area_type: "rural", is_bpl: true } };
const stepIds = (j: CompiledJourney) => j.orderedSteps.map((s) => s.nodeId);
const node = (id: string) => pension.nodes.find((n) => n.id === id);

describe("the money does not agree and the graph says so", () => {
  it("keeps all three IGNWPS amounts instead of choosing one", () => {
    const refs = node("output:ignwps_pension")?.sources ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(3);
    for (const r of refs) expect(r.verificationStatus).toBe("CONFLICTING");
    const quotes = refs.map((r) => r.evidence).join(" ");
    for (const amount of ["200", "300", "500", "700"]) expect(quotes).toContain(amount);
  });

  it("keeps both IGNOAPS amounts, from different pages", () => {
    const refs = (node("output:ignoaps_pension")?.sources ?? []).filter(
      (r) => r.verificationStatus === "CONFLICTING",
    );
    expect(new Set(refs.map((r) => r.sourceId)).size).toBeGreaterThanOrEqual(2);
  });

  it("tells the citizen the pages disagree rather than printing one number", () => {
    const j = compile("ignwps", { answers: { age: 45, has_remarried: false } });
    const step = j.orderedSteps.find((s) => s.nodeId === "service:ignwps");
    expect(step?.expectedOutput).toMatch(/do not agree|disagree/i);
    expect(step?.expectedOutput).toMatch(/200/);
    expect(step?.expectedOutput).toMatch(/700/);
  });

  it("links every page that disagrees, not just the first one", () => {
    const j = compile("ignwps", { answers: { age: 45, has_remarried: false } });
    const step = j.orderedSteps.find((s) => s.nodeId === "service:ignwps");
    expect(new Set(step?.sources.map((s) => s.source.url)).size).toBeGreaterThanOrEqual(3);
  });
});

describe("when two pages print two minimum ages, nobody gets turned away on the difference", () => {
  it("writes the IGNWPS age rule at the lower of the two published floors", () => {
    const rule = node("eligibility:ignwps_age")?.metadata?.rule;
    expect(rule).toEqual({ field: "age", operator: "GTE", value: 18 });
  });

  it("marks that rule's evidence as conflicting so the reader sees why", () => {
    for (const r of node("eligibility:ignwps_age")?.sources ?? []) {
      expect(r.verificationStatus).toBe("CONFLICTING");
    }
  });

  it("does not disqualify a 25 year old widow on an age printed two ways", () => {
    const j = compile("ignwps", { answers: { age: 25, has_remarried: false } });
    expect(stepIds(j)).toContain("service:ignwps");
    expect(j.warnings).toEqual([]);
  });
});

describe("the widow pension compiles the income certificate journey underneath it", () => {
  const j = compile("widow_pension", widow);

  it("puts the whole certificate journey before the pension application", () => {
    expect(stepIds(j).indexOf("service:income_certificate")).toBeLessThan(
      stepIds(j).indexOf("service:widow_pension"),
    );
    expect(stepIds(j)).toContain("action:income_certificate_form_36");
  });

  it("does this without the pension file naming the certificate journey", () => {
    const link = pension.edges.find(
      (e) => e.from === "service:widow_pension" && e.to === "document:income_certificate",
    );
    expect(link?.type).toBe("REQUIRES");
    expect(pension.nodes.some((n) => n.id === "service:income_certificate")).toBe(false);
  });

  it("collapses that entire branch for someone who already holds the certificate", () => {
    const held = compile("widow_pension", { ...widow, documents: ["document:income_certificate"] });
    expect(stepIds(held)).not.toContain("service:income_certificate");
    expect(stepIds(held)).not.toContain("verification:talati_hearing");
    expect(held.orderedSteps.length).toBeLessThan(j.orderedSteps.length);
  });
});

describe("who you are waiting on", () => {
  it("names the government, not the citizen, for the sanction", () => {
    const j = compile("widow_pension", widow);
    const b = j.blockers.find((x) => x.nodeId === "verification:mamlatdar_sanction");
    expect(b?.actor).toBe("GOVERNMENT");
    expect(b?.sources.length).toBeGreaterThan(0);
  });

  it("holds the sanction as the last thing on the state schemes", () => {
    for (const goal of ["widow_pension", "old_age_pension"]) {
      expect(stepIds(compile(goal, widow)).at(-1)).toBe("verification:mamlatdar_sanction");
    }
  });
});

describe("a citizen who types what a citizen actually types", () => {
  it("finds Ganga Swarupa from the name almost everyone still uses for it", () => {
    const [best] = resolveIntent(data, "vidhva sahay yojana");
    expect(best?.goal).toBe("service:widow_pension");
  });

  it("keeps the official Gujarati name on the node it belongs to", () => {
    expect(node("service:widow_pension")?.officialName).toMatch(/ગંગા/);
  });
});

describe("the old age income test admits rather than excludes", () => {
  it("accepts the rural limit, the urban limit or a BPL score, any one of them", () => {
    const rule = node("eligibility:old_age_income_or_bpl")?.metadata?.rule as { any?: unknown[] };
    expect(rule?.any?.length).toBe(3);
  });

  it("passes a BPL household that never answered the income question", () => {
    const j = compile("old_age_pension", { answers: { age: 65, bpl_score: 12 } });
    expect(stepIds(j)).toContain("service:old_age_pension");
  });
});

describe("what the pension graph refuses to invent", () => {
  it("ships no helpline, because the department page prints no number", () => {
    expect(pension.nodes.filter((n) => n.type === "HELPLINE")).toEqual([]);
  });

  it("gives IGNOAPS no UMANG channel, because that page 404s", () => {
    const umang = pension.edges.filter((e) => e.to === "portal:umang").map((e) => e.from);
    expect(umang).not.toContain("service:ignoaps");
  });

  it("keeps all four schemes separate rather than merging the state and central ones", () => {
    const services = pension.nodes.filter((n) => n.type === "SERVICE").map((n) => n.id);
    expect(services).toHaveLength(4);
    for (const goal of ["widow_pension", "old_age_pension", "ignwps", "ignoaps"]) {
      expect(compile(goal, widow).orderedSteps.length).toBeGreaterThan(0);
    }
  });

  it("quotes a page for every single node it does ship", () => {
    for (const n of pension.nodes) expect((n.sources ?? []).length).toBeGreaterThan(0);
  });
});
