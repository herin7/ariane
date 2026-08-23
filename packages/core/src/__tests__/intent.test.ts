import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/index";
import { resolveIntent } from "../intent";

/**
 * §51 says a Gujarati citizen describes the task in plain language. Their plain
 * language is not English, and it is often not even the Latin alphabet, so this
 * file exists to make sure the front door opens for both.
 *
 * Aliases are search keys, not government claims. Nothing here asserts a
 * requirement, a fee or an eligibility rule.
 */

const data = loadGraph();
const top = (query: string) => resolveIntent(data, query, 1)[0];

describe("plain language, in whichever script the citizen types it", () => {
  const cases: [string, string][] = [
    ["aavak nu dakhlo", "service:income_certificate"],
    ["આવકનો દાખલો", "service:income_certificate"],
    ["jati no dakhlo", "service:caste_certificate"],
    ["રહેઠાણનો દાખલો", "service:domicile_certificate"],
    ["kacchu licence", "service:learner_licence"],
    ["I want a driving licence", "service:driving_licence"],
    ["vidhva sahay yojana", "service:widow_pension"],
    ["વિધવા સહાય", "service:widow_pension"],
    ["vrudh pension", "service:old_age_pension"],
    ["શિષ્યવૃત્તિ", "service:nsp_scholarship"],
    ["my pf is stuck", "service:pf_final_settlement"],
  ];

  for (const [query, goal] of cases) {
    it(`"${query}" finds ${goal}`, () => {
      expect(top(query)?.goal).toBe(goal);
    });
  }
});

describe("what it refuses to do", () => {
  it("tokenises Gujarati at all, which the ASCII only split silently did not", () => {
    // The regression: /[^a-z0-9']+/ deleted every character of this and left an
    // empty query, so the citizen got a blank page and no explanation.
    expect(resolveIntent(data, "આવકનો દાખલો").length).toBeGreaterThan(0);
  });

  it("returns nothing rather than a nearest guess for a service we do not have", () => {
    expect(resolveIntent(data, "passport renewal appointment")).toEqual([]);
  });

  it("only ever answers with services that exist in the graph", () => {
    const services = new Set(data.nodes.filter((n) => n.type === "SERVICE").map((n) => n.id));
    for (const query of ["licence", "certificate", "pension", "scholarship"]) {
      for (const match of resolveIntent(data, query)) expect(services.has(match.goal)).toBe(true);
    }
  });

  it("says which words it matched, so a wrong guess is arguable", () => {
    expect(top("aavak nu dakhlo")?.matched).toContain("aavak");
  });

  it("keeps a Gujarati word whole instead of splitting it at the vowel signs", () => {
    // આવકનો is one word. A matra is a mark, not a letter, so \p{L} alone tore
    // it into આવકન plus a dropped ો and still matched, because the alias tore
    // the same way. The citizen saw the shrapnel in `matched`.
    expect(top("મારે આવકનો દાખલો જોઈએ છે")?.matched).toContain("આવકનો");
  });

  it("finds the certificate inside a whole Gujarati sentence, not just the bare term", () => {
    expect(top("મારે આવકનો દાખલો જોઈએ છે")?.goal).toBe("service:income_certificate");
  });
});
