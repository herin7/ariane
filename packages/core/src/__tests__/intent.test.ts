import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/providers";
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

describe("a central service is named, not guessed at", () => {
  // This used to assert passport returned nothing at all, which was the right
  // answer while the graph had never heard of it. It has now, and the honest
  // reply changed with it: we know the service, we know the Ministry of
  // External Affairs runs it, and we know we have not built it. Saying that is
  // strictly better than the silence this line used to require.
  it("passport resolves and admits it is not built", () => {
    const hit = top("passport renewal appointment");
    expect(hit?.goal).toBe("service:passport");
    expect(hit?.supportStatus).toBe("COMING_SOON");
    expect(hit?.authorityLevel).toBe("CENTRAL");
  });
});

describe("what it refuses to do", () => {
  it("tokenises Gujarati at all, which the ASCII only split silently did not", () => {
    // The regression: /[^a-z0-9']+/ deleted every character of this and left an
    // empty query, so the citizen got a blank page and no explanation.
    expect(resolveIntent(data, "આવકનો દાખલો").length).toBeGreaterThan(0);
  });

  it("returns nothing rather than a nearest guess for a service we do not have", () => {
    expect(resolveIntent(data, "fishing licence for the arabian sea")).toEqual([]);
  });

  it("only ever answers with services that exist in the graph", () => {
    const services = new Set(data.nodes.filter((n) => n.type === "SERVICE").map((n) => n.id));
    for (const query of ["licence", "certificate", "pension", "scholarship"]) {
      for (const match of resolveIntent(data, query)) expect(services.has(match.goal)).toBe(true);
    }
  });

  it("stays quiet when a citizen describes the problem instead of naming the service", () => {
    // These are the sentences the model pass exists for. Token overlap has
    // nothing useful to say about any of them: it used to answer anyway off a
    // single shared word, and because upstream stops at the first non empty
    // result, answering was how it stopped them from ever reaching the model.
    for (const query of [
      "my husband died and I have no income now",
      "I left my job and want the money from my provident fund",
      "I am 70 and nobody supports me",
    ]) {
      expect(resolveIntent(data, query)).toEqual([]);
    }
  });

  it("never counts a conjunction as a word that named a service", () => {
    // Half the catalogue has "and" in its official name. Matching on it is how
    // a pensioner got offered R&D support.
    for (const match of resolveIntent(data, "and")) expect(match.matched).not.toContain("and");
    expect(resolveIntent(data, "and or and")).toEqual([]);
  });

  it("still finds a service named inside a long polite sentence", () => {
    // The other side of that floor. Dropping weak matches must not start
    // dropping a citizen who said the words, just at length.
    expect(top("I really need to get an income certificate for my son school admission please")?.goal).toBe(
      "service:income_certificate",
    );
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

  it("reads one spelling of a Gujarati word when the graph holds another", () => {
    // વારસાઈ has no single English spelling and the state uses several. The
    // collectorate pages say varsai, the url says varshai, and a citizen types
    // whichever they last saw. One edit apart is one word.
    //
    // This used to assert on "varsai certificate" and on the graph reporting
    // back "varshai", the spelling it held. Both spellings are now names the
    // service answers to outright, so that query never reaches `near` and the
    // rule it was guarding went untested. Kunvarbai is the same shape and is
    // still uncurated: mameru against mamera, one edit, and nobody has written
    // either spelling down as an alias.
    const match = top("kunvarbai mameru");
    expect(match?.goal).toBe("service:kunvarbai_mamera_scheme");
    // Reported as the graph spells it, not as the citizen typed it, so the
    // screen shows them how we read the question.
    expect(match?.matched).toContain("mamera");
  });

  it("does not treat two short words one letter apart as the same word", () => {
    // The cost of the rule above, and why it has a length floor. There is no
    // service here for either, and inventing a match between them would be
    // worse than the transliteration miss it was added to fix.
    expect(resolveIntent(data, "pen")).toEqual([]);
    expect(resolveIntent(data, "farm licence")?.some((m) => m.goal === "service:form_licence")).toBe(false);
  });
});

/**
 * One service owns one citizen concept, whatever the citizen calls it.
 *
 * These are the names a Gujarati citizen types for services this graph has had
 * all along and could not find. `service:varshai` has nine required documents,
 * three sources and a published 60 day timeline, and "legal heir certificate"
 * returned an empty screen, because the Kheda collectorate writes વારસાઈ and
 * never writes the English name. An empty screen is the failure mode nobody
 * reports: it looks like the service does not exist rather than like a bug.
 *
 * The names live in `docs/research/service-names.tsv` and are applied by
 * `services-compile.mjs`, so a recompile cannot quietly drop them. That is what
 * these guard. They assert only that a query reaches a service; not one of them
 * asserts a fee, a document or a rule, because a name is not a fact.
 */
describe("one service per thing, however the citizen names it", () => {
  const heir = ["legal heir certificate", "legal heir", "heirship certificate", "varsai", "varsai certificate", "varasai", "varshai", "વારસાઈ", "વારસાઈ પ્રમાણપત્ર"];

  for (const query of heir) {
    it(`"${query}" is the same service as every other name for it`, () => {
      expect(top(query)?.goal).toBe("service:varshai");
    });
  }

  it("does not answer a succession certificate with a varsai one", () => {
    // A succession certificate is a civil court document under the Indian
    // Succession Act. A varsai certificate is a revenue heirship record. They
    // sound alike in English and they are not the same thing, so the honest
    // answer to a service we have not mapped is still nothing at all.
    expect(resolveIntent(data, "succession certificate")).toEqual([]);
  });

  it("offers every ration card in both scripts, because there is no single one", () => {
    // Not a canonicalisation bug, which is what it looked like. Gujarat issues
    // several and the citizen has to pick: a lost card is a duplicate, a
    // below poverty line household is Antyodaya. Naming one of them canonical
    // would be inventing a fact about the state's own scheme design.
    //
    // What was actually broken is that the Gujarati name only reached two of
    // them, so a citizen typing રેશન કાર્ડ saw a shorter list than one typing
    // in English and had no way to know something was missing.
    const english = resolveIntent(data, "ration card", 5).map((m) => m.goal);
    const gujarati = resolveIntent(data, "રેશન કાર્ડ", 5).map((m) => m.goal);
    for (const id of ["service:food_ration_card", "service:duplicate_ration_card", "service:smart_ration_card"]) {
      expect(english).toContain(id);
      expect(gujarati).toContain(id);
    }
  });

  it("finds the below poverty line card by the scheme name people actually use", () => {
    expect(top("antyodaya")?.goal).toBe("service:antyodaya_anna_yojana_aay_ration_card");
    expect(top("aay card")?.goal).toBe("service:antyodaya_anna_yojana_aay_ration_card");
  });

  it("keeps every curated name pointed at a service that exists", () => {
    // The file is edited by hand and the graph is rebuilt by a machine, so a
    // service can be renamed out from under a row. `services-compile.mjs`
    // reports that at compile time; this fails the build if nobody read it.
    const services = new Set(data.nodes.filter((n) => n.type === "SERVICE").map((n) => n.id));
    for (const query of [...heir, "antyodaya", "aay card", "રેશન કાર્ડ"]) {
      for (const match of resolveIntent(data, query)) expect(services.has(match.goal)).toBe(true);
    }
  });
});
