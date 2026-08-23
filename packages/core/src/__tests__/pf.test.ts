import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { compileJourney } from "../journey";
import type { CitizenContext, CompiledJourney } from "../types";

/**
 * PF withdrawal is the journey where the citizen is not the bottleneck.
 *
 * Almost every way a PF claim dies is somebody else's move: the employer has
 * not approved the KYC, the employer has not marked the date of exit, the
 * employer's digital signature has expired. The single most valuable sentence
 * this graph can produce is that filing the claim again will not fix any of
 * that. These tests exist so that sentence cannot quietly stop being produced.
 */

const data = loadGraph();

const compile = (citizen?: CitizenContext, goal = "pf_withdrawal"): CompiledJourney =>
  compileJourney(data, {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
    citizen,
  });

const stepIds = (j: CompiledJourney) => j.orderedSteps.map((s) => s.nodeId);
const at = (j: CompiledJourney, id: string) => stepIds(j).indexOf(id);
const before = (j: CompiledJourney, a: string, b: string) => at(j, a) >= 0 && at(j, a) < at(j, b);

describe("the things standing between you and your money belong to your employer", () => {
  const j = compile();

  it("names the employer, not the citizen, on every blocker", () => {
    expect(j.blockers.length).toBeGreaterThan(0);
    for (const b of j.blockers) expect(b.actor).toBe("EMPLOYER");
  });

  it("says outright that filing again changes nothing", () => {
    const kyc = j.blockers.find((b) => b.nodeId === "verification:pf_employer_kyc_approval");
    expect(kyc?.reason).toMatch(/filing the claim again changes nothing/i);
  });

  it("gives you somewhere to escalate when the employer will not move", () => {
    const kyc = j.blockers.find((b) => b.nodeId === "verification:pf_employer_kyc_approval");
    expect(kyc?.resolution).toMatch(/epfigms/i);
    expect(j.escalationPaths.map((c) => c.nodeId)).toContain("grievance:epfigms");
  });

  it("quotes an official page for each of them", () => {
    for (const b of j.blockers) {
      expect(b.sources.length).toBeGreaterThan(0);
      for (const s of b.sources) expect(s.evidence?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("the order is the order a member would actually do it in", () => {
  const j = compile();

  it("activates the UAN before telling you to log in and do anything with it", () => {
    expect(before(j, "action:pf_activate_uan", "action:pf_mark_date_of_exit")).toBe(true);
    expect(before(j, "action:pf_activate_uan", "action:pf_link_kyc_to_uan")).toBe(true);
  });

  it("puts your half of the KYC before the employer's half", () => {
    expect(before(j, "action:pf_link_kyc_to_uan", "verification:pf_employer_kyc_approval")).toBe(true);
  });

  it("ends on the claim, not on a prerequisite", () => {
    expect(stepIds(j).at(-1)).toBe("service:pf_final_settlement");
  });
});

describe("a shut down company gets a different answer", () => {
  it("offers the field office attestation route and stops chasing the DSC", () => {
    const closed = compile({ answers: { establishment_closed: true } });
    expect(stepIds(closed)).toContain("action:pf_kyc_via_field_office_attestation");
    expect(stepIds(closed)).not.toContain("verification:pf_employer_dsc_registered");
  });

  it("keeps chasing the DSC when the company is still trading", () => {
    const open = compile({ answers: { establishment_closed: false } });
    expect(stepIds(open)).not.toContain("action:pf_kyc_via_field_office_attestation");
  });
});

describe("EPFO contradicts itself and the graph keeps both sides", () => {
  it("keeps the 9.5 year and 10 year service rules apart instead of averaging them", () => {
    const edge = data.edges.find((e) => e.id === "e:pf10c_requires_eligible_service");
    expect(edge?.verificationStatus).toBe("CONFLICTING");
    expect(edge?.note).toMatch(/9|10/);
    for (const s of edge?.sources ?? []) expect(s.evidence?.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps both the old cannot edit rule and the 2025 self update rule", () => {
    const edge = data.edges.find((e) => e.id === "e:pf_correct_profile_apply_at_member_portal");
    expect(edge?.verificationStatus).toBe("CONFLICTING");
    expect((edge?.sources ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("what the graph refuses to say", () => {
  it("does not invent an EPFO office address it never found", () => {
    const office = data.nodes.find((n) => n.id === "office:epfo_field_office");
    expect(office?.metadata?.address).toBeUndefined();
    expect(office?.metadata?.phoneNumbers).toBeUndefined();
  });

  it("does not invent a fee, because no page printed one", () => {
    expect(data.nodes.filter((n) => n.id.startsWith("payment:pf"))).toEqual([]);
  });

  it("does not ship a mobile app node without a store id", () => {
    for (const n of data.nodes.filter((x) => x.type === "MOBILE_APP")) {
      expect(Boolean(n.metadata?.androidAppId || n.metadata?.iosAppId)).toBe(true);
    }
  });
});

describe("the other three PF claims compile too", () => {
  for (const goal of ["pf_pension_withdrawal", "pf_advance", "pf_transfer"]) {
    it(`${goal} produces a path with sources on every step`, () => {
      const j = compile(undefined, goal);
      expect(j.orderedSteps.length).toBeGreaterThan(0);
      expect(j.warnings).toEqual([]);
      for (const step of j.orderedSteps) expect(step.sources.length).toBeGreaterThan(0);
    });
  }

  it("leads a transfer with the missing date of exit, because that is what stops transfers", () => {
    const j = compile(undefined, "pf_transfer");
    expect(stepIds(j)).toContain("verification:pf_date_of_exit_recorded");
  });
});
