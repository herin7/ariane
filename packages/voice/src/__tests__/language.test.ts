import { describe, expect, it } from "vitest";
import { LANGUAGES, instructionsFor, languageName, languageTag } from "../agent";

/**
 * English first, Indian languages on request, nothing else.
 *
 * The prompt asks; `languageTag` is what actually holds, because a saved
 * preference is read back on the next call as "Start in X" and a model-supplied
 * string should not be able to become that.
 */

const INDIAN = ["hi", "gu", "mr", "bn", "ta", "te", "kn", "ml", "pa", "or", "as", "ur"];

describe("the languages Ariane speaks", () => {
  it("is English plus the Indian ones, and nothing else", () => {
    expect(Object.keys(LANGUAGES)).toEqual(["en", ...INDIAN]);
  });

  it("accepts a tag, a region suffix or the name", () => {
    for (const shape of ["gu", "GU", " gu ", "gu-IN", "gu_IN", "Gujarati", "gujarati"]) {
      expect(languageTag(shape)).toBe("gu");
    }
  });

  it("refuses every language from outside India", () => {
    for (const foreign of ["fr", "es", "de", "ar", "zh", "ru", "ja", "pt-BR", "French", "Mandarin", "Klingon", ""]) {
      expect(languageTag(foreign)).toBeUndefined();
    }
  });

  it("falls back to English rather than naming something it cannot speak", () => {
    expect(languageName("fr")).toBe("English");
    expect(languageName("ta")).toBe("Tamil");
  });
});

describe("what the model is told", () => {
  const prompt = instructionsFor({ identityLevel: "ANONYMOUS", returning: false, needsConsentLine: false });

  it("names English as the default and the Indian languages as the alternatives", () => {
    expect(prompt).toMatch(/English is the default/);
    for (const tag of INDIAN) expect(prompt).toContain(LANGUAGES[tag]);
  });

  it("closes the obvious ways round it", () => {
    // A caller asking, claiming they cannot understand, or invoking authority.
    expect(prompt).toMatch(/do not switch even if they ask you to/i);
    expect(prompt).toMatch(/cannot understand English/i);
    expect(prompt).toMatch(/authorised/i);
  });

  it("still starts a returning caller in their own language", () => {
    const started = instructionsFor({
      identityLevel: "RECOGNIZED",
      returning: true,
      needsConsentLine: false,
      language: "ta",
    });
    expect(started).toContain("Start in Tamil");
  });

  it("will not start a call in a language it does not speak", () => {
    const started = instructionsFor({
      identityLevel: "RECOGNIZED",
      returning: true,
      needsConsentLine: false,
      language: "fr",
    });
    // The base prompt names French as an example of what to refuse, so the
    // assertion is on the closing instruction rather than on the whole string.
    expect(started).toContain("Start in English");
    expect(started).not.toMatch(/Start in French/);
  });
});
