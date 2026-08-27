import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDir } from "../data/providers";

/**
 * The fifty hard cases, checked as a research artifact rather than as a graph.
 *
 * `pnpm edge:research` goes and finds what an ordinary sentence actually
 * triggers: a café is a food licence and a fire condition and an employer
 * registration, and none of the three is universal. The finding that matters is
 * not the licence, it is the condition attached to it, and the failure this
 * file guards against is the pass quietly turning "may be required above 2500
 * litres" into "is required".
 *
 * Two things are asserted and they are different:
 *
 *   discipline   every claim is quoted off an official page of the right
 *                jurisdiction, and a case that found nothing says so
 *   containment  the artifact is not a graph bundle, so nothing in it can
 *                reach a citizen without somebody deciding it should
 *
 * The evidence rule is restated here rather than imported, on purpose and for
 * the same reason `cli/quotes.ts` restates it: a check that shares its
 * implementation with the thing it checks cannot fail when that implementation
 * is wrong.
 *
 * Skipped when the artifact is absent. A clone has no `.graph`, and a research
 * pass nobody has run is not a broken build.
 */

const REPORT = join(snapshotDir(), "research", "edge-cases.json");

interface Claim {
  permission: string;
  trigger: string | null;
  exemption: string | null;
  evidence: string;
  sourceUrl: string;
  sourceHost: string;
}

interface Record {
  caseId: string;
  ask: string;
  status: string;
  claims: Claim[];
  conflicts: { permission: string; triggers: string[]; hosts: string[] }[];
}

const report = existsSync(REPORT) ? (JSON.parse(readFileSync(REPORT, "utf8")) as { records: Record[]; note: string }) : null;
const cases = report?.records ?? [];
const claims = cases.flatMap((r) => r.claims.map((c) => ({ ...c, caseId: r.caseId })));

const OTHER_STATE =
  /(andhra|arunachal|assam|bihar|chhattisgarh|goa|haryana|himachal|jharkhand|karnataka|kerala|madhya|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil|telangana|tripura|uttar|west[-_]?bengal|jammu|kashmir|ladakh|puducherry|chandigarh)/i;

describe.skipIf(!report)("the fifty case research pass", () => {
  it("quotes every claim off an official government page", () => {
    for (const c of claims) {
      expect(c.sourceHost, `${c.caseId}: ${c.sourceUrl}`).toMatch(/(^|\.)(gov|nic)\.in$/);
    }
  });

  it("never answers a Gujarat question with another state's page", () => {
    // True, verbatim and useless: the first probe cited Jammu and Kashmir's
    // shops and establishment page for a café in Ahmedabad.
    for (const c of claims) {
      const other = OTHER_STATE.test(c.sourceUrl) && !/gujarat/i.test(c.sourceUrl);
      expect(other, `${c.caseId} cites ${c.sourceUrl}`).toBe(false);
    }
  });

  it("keeps only evidence long enough to be a rule", () => {
    for (const c of claims) {
      expect(c.evidence.trim().split(/\s+/).length, `${c.caseId}: "${c.evidence}"`).toBeGreaterThanOrEqual(8);
    }
  });

  it("does not call a permission verified without the condition that triggers it", () => {
    for (const r of cases.filter((x) => x.status === "VERIFIED")) {
      expect(r.claims.some((c) => c.trigger || c.exemption), r.caseId).toBe(true);
    }
  });

  it("says it found nothing rather than reporting a permission it cannot show", () => {
    for (const r of cases.filter((x) => x.status === "UNVERIFIED")) {
      expect(r.claims, r.caseId).toHaveLength(0);
    }
  });

  it("keeps both sides of a conflict instead of picking one", () => {
    for (const r of cases.filter((x) => x.status === "CONFLICTING")) {
      expect(r.conflicts.length, r.caseId).toBeGreaterThan(0);
      for (const c of r.conflicts) {
        expect(c.triggers.length, `${r.caseId}/${c.permission}`).toBeGreaterThan(1);
        expect(c.hosts.length, `${r.caseId}/${c.permission}`).toBeGreaterThan(1);
      }
    }
  });

  it("is not a graph bundle, so none of it can reach a citizen by itself", () => {
    // The provider reads `*.json` in the snapshot directory and does not
    // descend. Research lives one level down, which is the containment: it is
    // structural, not a rule somebody has to remember.
    const bundles = readdirSync(snapshotDir()).filter((f) => f.endsWith(".json") && statSync(join(snapshotDir(), f)).isFile());
    expect(bundles).not.toContain("edge-cases.json");
    expect(report?.note).toMatch(/research only/i);
  });
});
