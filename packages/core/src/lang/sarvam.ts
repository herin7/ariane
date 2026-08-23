/**
 * Sarvam, for citizens who do not describe a government problem in English.
 *
 * This sits in front of intent resolution and nowhere else. It translates the
 * question, never the answer. Government facts stay in the language the
 * government published them in, because "મામલતદાર" translated to "the officer"
 * is how a citizen ends up at the wrong desk, and a verbatim quote that has
 * been through a translator is no longer a verbatim quote.
 *
 * The graph still decides. All this does is get the citizen's words into the
 * one language the aliases are written in, and remember which language they
 * actually spoke so the UI can say so.
 *
 * Every function here degrades to the input unchanged. A missing key, a down
 * API or a bad response means the citizen gets the token overlap path, which is
 * worse but never wrong.
 */

const ENDPOINT = "https://api.sarvam.ai/translate";

/** Sarvam's own code for "work it out yourself". */
const AUTO = "auto";

export interface Understood {
  /** What we will actually run intent resolution against. */
  english: string;
  /** What the citizen typed, untouched. */
  original: string;
  /** BCP 47 ish code Sarvam detected, e.g. `gu-IN`. Undefined if we never asked. */
  detected?: string;
  /** True when the text was sent to Sarvam and came back changed. */
  translated: boolean;
}

export function sarvamKeyFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const key = env.SARVAM_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * Latin script with no Indic characters is already the language the aliases are
 * written in. "aavak nu dakhlo" is Gujarati, but it is Gujarati the alias list
 * already knows, so sending it to a translator costs a round trip and risks
 * turning a search key into a sentence.
 */
function looksLikeEnglishScript(text: string): boolean {
  return !/[ऀ-෿]/.test(text);
}

/**
 * Citizen's words in, English out.
 *
 * Skips the network entirely when there is no key, when the text is already in
 * Latin script, or when the text is empty. Never throws.
 */
export async function understand(
  text: string,
  options: { key?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Understood> {
  const original = text.trim();
  const key = options.key ?? sarvamKeyFromEnv();
  const untouched: Understood = { english: original, original, translated: false };

  if (!key || !original || looksLikeEnglishScript(original)) return untouched;

  const controller = new AbortController();
  // A citizen waiting on a search box will not wait four seconds for a
  // translation that is only ever an optimisation over the alias list.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);

  try {
    const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { "api-subscription-key": key, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        input: original,
        source_language_code: AUTO,
        target_language_code: "en-IN",
        mode: "formal",
      }),
    });

    if (!response.ok) return untouched;

    const body = (await response.json()) as { translated_text?: string; source_language_code?: string };
    const english = body.translated_text?.trim();
    if (!english) return untouched;

    return {
      english,
      original,
      detected: body.source_language_code,
      translated: english.toLowerCase() !== original.toLowerCase(),
    };
  } catch {
    // Timeout, network, malformed JSON. All the same answer: use their words.
    return untouched;
  } finally {
    clearTimeout(timer);
  }
}
