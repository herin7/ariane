import type { SpeakableFact } from "./types";

/**
 * The two soft layers, either side of the hard one.
 *
 * §15 asks for three layers and the middle one is the only one that decides
 * anything: the broker. Nothing in this file grants access, revokes access or
 * resolves identity, and nothing in it is asked to a model. It is pattern
 * matching, which means it is fallible, which is exactly why it is not load
 * bearing. If every function here returned ALLOW the system would still be
 * safe, because the tool surface is what an attacker is actually up against.
 *
 * What these layers buy is the difference between an attack that fails and an
 * attack that fails *and is noticed*, plus a floor under §14: the model may
 * rephrase a fee, and it may not invent one.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type InputVerdict = "ALLOW" | "FLAG" | "REFUSE";

export interface InputCheck {
  verdict: InputVerdict;
  /** Machine-readable, for telemetry. Never read to the caller. */
  reasons: string[];
  /** What to say when the verdict is REFUSE. Deliberately incurious. */
  speak?: string;
}

/**
 * Things that are never a citizen asking about a certificate.
 *
 * Kept narrow on purpose. §15 says do not over-block normal users, and the
 * expensive mistake here is refusing a grieving person who phrased something
 * oddly, not letting a jailbreak through to a tool surface that has nothing on
 * it. So these patterns describe attacks on *the system*, and say nothing about
 * tone, topic, or how upset somebody sounds.
 *
 * Hindi and Gujarati alongside English because an attacker who reads §21 will
 * try the other two, and because a filter that only speaks English on an Indian
 * product is theatre.
 */
const INJECTION_PATTERNS: [RegExp, string, severe?][] = [
  [/\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i, "override-instructions"],
  [/\bdisregard\s+(your|all|the)\s+(instructions?|rules?|system|training)/i, "override-instructions"],
  // Not severe: "I lost the original message from the department" is a real
  // sentence a real person says, and refusing it is the expensive mistake.
  [/\b(system|initial|original)\s+(prompt|message|instructions?)\b/i, "prompt-mention"],
  [/\b(reveal|show|print|repeat|tell\s+me)\s+(your|the)\s+(prompt|instructions?|rules?|context|configuration)/i, "prompt-extraction", true],
  [/\b(api[_\s-]?key|secret|token|password|credential|env(ironment)?\s+variable)s?\b/i, "secret-request"],
  [/\b(previous|other|another|last)\s+(caller|user|customer|person|citizen)('?s)?\b/i, "cross-user", true],
  [/\b(citizen|user|customer|account)[_\s-]?id\s*(is|=|:)/i, "identity-assertion"],
  // "the admin" as well as "an admin": `a|an` alone missed the wording §19
  // lists verbatim, which is the one everybody actually types.
  [/\bi\s*('?m|\s+am)\s+(an?\s+|the\s+)?(admin|administrator|developer|root|superuser|owner)\b/i, "identity-assertion"],
  [/\bremember\s+that\s+i\s*('?m|\s+am)\s+(an?\s+)?(admin|administrator|verified|authorised|authorized)/i, "identity-assertion"],
  [/\b(run|execute|eval)\s+(this|the following|these)?\s*(code|sql|query|script|command)/i, "code-execution"],
  [/\b(select|insert|update|delete|drop)\s+.{0,20}\b(from|into|table)\b/i, "code-execution"],
  [/\b(fetch|curl|wget|open|visit|call)\s+(this\s+)?(url|link|webhook|endpoint|https?:\/\/)/i, "network-request"],
  [/\b(skip|bypass|disable|turn\s+off)\s+(the\s+)?(verification|authentication|security|guardrails?|limits?)/i, "bypass"],
  [/\bjust\s+say\s+(i'?m|i\s+am|that\s+i'?m)\s+eligible/i, "forced-claim"],
  [/\b(make\s+up|invent|guess|assume)\s+(the|a|an)\s+(document|fee|requirement|answer)/i, "forced-claim"],
  [/\buse\s+your\s+(own\s+)?(training|knowledge|memory)\s+(instead|rather)/i, "forced-claim"],

  // Hindi / Gujarati, Devanagari, Gujarati script and the romanised forms that
  // are what people actually type and say.
  //
  // Severe where the English equivalent is, and that has to be stated rather
  // than inherited: "tell me your system prompt" trips two English patterns and
  // refuses on the count, while its Gujarati twin trips one and would only be
  // flagged. A filter that is stricter in English on an Indian product is not a
  // filter, it is an accident with a language preference.
  [/(पिछले|पहले)\s*(निर्देश|इंस्ट्रक्शन)/i, "override-instructions"],
  [/(अपना|तुम्हारा)\s*(सिस्टम\s*)?(प्रॉम्प्ट|निर्देश)\s*(बताओ|दिखाओ)/i, "prompt-extraction", true],
  [/(पिछले|दूसरे)\s*(कॉलर|व्यक्ति|यूज़र)\s*(की|का)/i, "cross-user", true],
  [/(તમારો|તમારું)\s*(સિસ્ટમ\s*)?(પ્રોમ્પ્ટ|સૂચના)/i, "prompt-extraction", true],
  [/(આગળના|બીજા)\s*(કોલર|વ્યક્તિ)/i, "cross-user", true],
  [/\b(pehle|pichle)\s+(ke\s+)?(sab\s+)?(instruction|nirdesh)/i, "override-instructions"],
  [/\b(tamaro|tumhara|aapka)\s+(system\s+)?prompt\b/i, "prompt-extraction", true],
  [/\b(pichhla|pichle|biju|dusre)\s+(caller|vyakti|user)\b/i, "cross-user", true],
  [/\bmane\s+(admin|verified)\s+(bana|ganvo|samjo)\b/i, "identity-assertion", true],
];

/**
 * A pattern that is never a citizen asking about a certificate, in any
 * language. One of these is enough on its own; the rest need corroboration.
 */
type severe = true;

/**
 * How many patterns have to fire before a turn is refused rather than flagged.
 *
 * One is a coincidence often enough to matter. "I need my previous caller ID
 * letter" is a real sentence, and so is a person asking whether there is a fee
 * for a password reset. Two independent attack patterns in one breath is not.
 */
const REFUSE_AT = 2;

/** Longest utterance we will consider at all. Past this it is a payload. */
const MAX_UTTERANCE = 1_000;

export function checkInput(text: string): InputCheck {
  if (text.length > MAX_UTTERANCE) {
    return { verdict: "REFUSE", reasons: ["oversized"], speak: "That was a lot at once. Tell me the main thing you need." };
  }

  const hits = INJECTION_PATTERNS.filter(([re]) => re.test(text));
  // Counted by pattern, reported by reason. "run this sql: select * from
  // voice_citizens" trips two different patterns that happen to share a label,
  // and that is two independent signals however it is filed.
  const reasons = [...new Set(hits.map(([, reason]) => reason))];
  if (hits.length >= REFUSE_AT || hits.some(([, , severe]) => severe)) {
    return {
      verdict: "REFUSE",
      reasons,
      // Says nothing about what tripped, because a refusal that explains itself
      // is a refusal an attacker can iterate against.
      speak: "I can only help with your own government services. What do you need to get done?",
    };
  }
  return { verdict: reasons.length ? "FLAG" : "ALLOW", reasons };
}

/**
 * Caller speech, as it reaches the model.
 *
 * The transcript is DATA. It is wrapped so the model sees a labelled quotation
 * rather than a sentence in its own instruction stream, and the delimiter is
 * stripped out of the content first so nobody can close it early. This is
 * belt-and-braces next to the tool surface, and it costs one line.
 */
export function asCallerData(text: string): string {
  return `<caller_speech>${text.replace(/[<>]/g, " ")}</caller_speech>`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface OutputCheck {
  ok: boolean;
  reasons: string[];
  /** Claims the model made that no Ariane result stands behind. §14. */
  ungrounded: string[];
  /** What to say instead, when `ok` is false. Never falls back to model knowledge. */
  speak?: string;
}

/** Shapes that are a leak whatever else is going on. */
const LEAK_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, "openai-key"],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/, "supabase-key"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "jwt"],
  [/\bAKIA[0-9A-Z]{16}\b/, "aws-key"],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/i, "bearer-token"],
  [/\b(SUPABASE|OPENAI|VAPI|AWS|SARVAM|LANGFUSE|ADMIN|RATE_LIMIT|VOICE|CRON|AZURE|DATABASE|ARIANE)_[A-Z_]{3,}\b/, "env-name"],
  // §8 names these two specifically. A connection string is a password with a
  // hostname attached, and an admin credential does not become safe by being
  // lowercase.
  [/\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/\S+/i, "database-url"],
  [/\b[a-z]+-(test-)?secret-[A-Za-z0-9_-]{8,}/i, "credential"],
  // Anything else long enough and opaque enough to be a key. Ariane says fees,
  // dates, office names and document names; none of them is a 24 character run
  // of letters and digits with no space in it.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/, "opaque-token"],
  [/\bcitizen_[a-z0-9-]{4,}\b/i, "internal-id"],
  [/\b[0-9a-f]{32,}\b/i, "digest"],
  [/\bat\s+[A-Za-z]+\s*\([^)]*[\\/][^)]*:\d+:\d+\)/, "stack-trace"],
  [/\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|PostgrestError|column\s+"[a-z_]+"\s+does not exist)/i, "internal-error"],
  [/You are Ariane'?s conversational voice interface/i, "system-prompt"],
];

/**
 * Kinds of thing that must have come from Ariane.
 *
 * Numbers, because a fee and a deadline are the two claims that cost a citizen
 * a wasted trip. Domains, because a portal that does not exist is worse than no
 * portal. Phone numbers, because a wrong helpline is a person shouting into a
 * stranger's phone.
 */
const MONEY = /(?:₹|\brs\.?\s*|\brupees?\s*)\s*([\d][\d,]*)/gi;
const DURATION = /\b(\d+)\s*(?:to\s*\d+\s*)?(working\s+)?(day|days|week|weeks|month|months|year|years)\b/gi;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+(?:gov\.in|nic\.in|org\.in|co\.in|com|in|org|net))\b/gi;
const PHONE = /\b(1800[\s-]?\d[\d\s-]{5,12}|\b\d{10}\b|\b1[89]\d{2,4}\b)/g;

/**
 * A phrase that names a government artefact.
 *
 * The blunt half of the check, and knowingly so. Full entity recognition over
 * three languages is not a thing to build in a voice adapter, and a strict
 * version would refuse a model for saying "your income certificate" in a
 * sentence where Ariane returned "Income Certificate (Aavak nu Dakhlo)". So it
 * looks for the shapes that carry the most risk of invention: a capitalised
 * phrase ending in a government noun.
 *
 * Known limit: being a capitalised-phrase heuristic, it misses lowercase
 * inventions. Upgrade to matching against the graph's own document and office
 * name index if the eval shows it letting things through.
 */
const ARTEFACT = /\b((?:[A-Z][\w'-]*\s+){0,3}(?:Certificate|Card|Licence|License|Portal|Office|Department|Scheme|Yojana|Form|Affidavit|Passbook))\b/g;

/** Words that are always fine to say and are not claims about government. */
const OPEN_VOCABULARY = new Set([
  "aadhaar", "pan", "portal", "office", "certificate", "document", "government",
  "application", "form", "website", "helpline", "step", "fee",
]);

/**
 * Everything the model is allowed to assert, flattened for substring matching.
 *
 * Normalised hard: lowercase, punctuation and whitespace collapsed, digits kept
 * as digits. "Rs. 50/-" in a source and "fifty rupees" out of the model will
 * not match, and that is the right direction to fail in. A missed match costs a
 * safe fallback line; a false match costs a citizen the wrong fee.
 */
function groundingText(grounding: SpeakableFact[]): string {
  return grounding
    .map((f) => f.text)
    .join("   ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ");
}

const normalise = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function checkOutput(text: string, grounding: SpeakableFact[]): OutputCheck {
  const reasons = LEAK_PATTERNS.filter(([re]) => re.test(text)).map(([, reason]) => reason);
  if (reasons.length) {
    return {
      ok: false,
      reasons,
      ungrounded: [],
      speak: "Let me stick to what I can actually check for you. What would you like to know?",
    };
  }

  const haystack = groundingText(grounding);
  const ungrounded: string[] = [];

  const claim = (raw: string, key: string) => {
    const needle = normalise(key);
    if (!needle || OPEN_VOCABULARY.has(needle)) return;
    if (!haystack.includes(needle)) ungrounded.push(raw.trim());
  };

  for (const [raw, amount] of text.matchAll(MONEY)) claim(raw, amount ?? "");
  for (const [raw, count, , unit] of text.matchAll(DURATION)) claim(raw, `${count ?? ""} ${unit ?? ""}`);
  for (const [raw, domain] of text.matchAll(DOMAIN)) claim(raw, domain ?? "");
  for (const [raw] of text.matchAll(PHONE)) claim(raw, raw);
  for (const [raw, phrase] of text.matchAll(ARTEFACT)) claim(raw, phrase ?? "");

  if (ungrounded.length) {
    return {
      ok: false,
      reasons: ["ungrounded-claim"],
      ungrounded: [...new Set(ungrounded)],
      /**
       * §16, said out loud. Not "I think it might be around five hundred
       * rupees". The fallback is that we do not know, because falling back to
       * the model's own knowledge is the one failure this product cannot have.
       */
      speak: "I cannot verify that part, so I would rather not say it. Let me check what the official page actually gives us.",
    };
  }

  return { ok: true, reasons: [], ungrounded: [] };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * What may be written down about a call. §19.
 *
 * Applied before anything reaches a log, a metric or an observability provider,
 * rather than at the sink, because a masker that runs at the sink is a masker
 * somebody bypasses by adding one more `console.log`.
 */
const SENSITIVE = [
  // Ordered: the ones that would otherwise be swallowed by a broader pattern
  // go first. A `sk-` key contains no spaces and would survive [account], but
  // an OTP is digits and would not survive it, so OTP is matched earlier.
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]"],
  [/\b(otp|code|password|passcode|pin|cvv)\s*(is|=|:)?\s*\d{3,8}\b/gi, "[otp]"],
  [/\b(password|passphrase|pwd)\s*(is|=|:)\s*\S+/gi, "[password]"],
  [/\bbearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "[bearer]"],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g, "[supabase-key]"],
  [/\bAKIA[0-9A-Z]{12,}/g, "[aws-key]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]+/g, "[jwt]"],
  // A secret nobody gave a prefix to: an admin session secret, an ip hashing
  // key, a password hash. All of them are just a long unbroken run of key
  // alphabet, so that is what this matches - 24 or more characters with at
  // least one letter and one digit among them. No sentence in any of the
  // three languages Ariane speaks contains one, and a service id has no
  // digits, so this costs nothing on real callers.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[token]"],
  [/\b\+?\d[\d\s()-]{7,}\d\b/g, "[phone]"],
  [/\b[\w.%-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]"],
  // Bank accounts and card numbers, both of which are just long digit runs.
  [/\b\d{9,18}\b/g, "[account]"],
] as const;

/**
 * A string with everything sensitive taken out of it, at a length you choose.
 *
 * Split out of `redact` because the two callers want different lengths for the
 * same masking. Telemetry wants 200 characters, because a log line is a hint.
 * A stored transcript wants the whole sentence, because an operator reading a
 * complaint needs to see what was actually said — minus the Aadhaar number the
 * citizen read out loud, which is the part this removes.
 *
 * Not a guarantee, and it is not the only defence: `voice_turns.text` is capped
 * in Postgres too, and the patterns above are a best effort against a caller
 * who says their card number in words. It removes every machine-shaped secret
 * and the identifiers people actually recite.
 */
export function redactText(text: string, limit = 200): string {
  const masked = SENSITIVE.reduce<string>((value, [re, to]) => value.replace(re, to), text);
  return masked.length > limit ? `${masked.slice(0, limit)}…` : masked;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/token|secret|key|phone|aadhaar|pan|otp|password|transcript|audio/i.test(key))
        .slice(0, 20)
        .map(([key, v]) => [key, redact(v, depth + 1)]),
    );
  }
  return value;
}
