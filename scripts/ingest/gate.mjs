/**
 * The one rule the whole product rests on: did the page actually say this?
 *
 * Lifted out of `services-extract.mjs` when a second extractor needed it. There
 * are already two copies of this comparison in the repo, here and in
 * `packages/core/src/cli/quotes.ts`, and that one is deliberate: the audit has
 * to be able to fail independently of the extractor it audits, and the extract
 * selftest asserts the two agree character for character. A third copy would be
 * neither of those things, it would just be a place for the rule to drift.
 *
 * Nothing here calls a model, touches the network or reads a file. It is a
 * string comparison and a list of kinds, and the reason it is its own module is
 * that everything which produces a claim has to go through it.
 */

/**
 * Markdown out of both sides before comparing.
 *
 * The pages are markdown and the model quotes what it reads, so it quotes the
 * rendered words while the page holds an emphasis marker, an escape or a link.
 * Of 14,869 facts that got through the gate, the number whose evidence
 * contained `**` or a markdown link was zero. Not few. Zero. Every bolded
 * requirement and every linked form on the estate was being dropped as though
 * the model had made it up.
 *
 * This does not soften the gate, it just stops comparing in the wrong space.
 * Both sides get the same treatment, so a paraphrase still has different
 * letters in it and still fails.
 */
export const unmark = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([-.*_[\]()#+!`>~])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "");

/** Character for character the same rule as `packages/core/src/cli/quotes.ts`. */
export const norm = (s) => unmark(s).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Did this quote come off this page?
 *
 * One substring check after whitespace and markup normalisation. No fuzzy
 * matching, no edit distance, no "close enough". A quote trimmed differently
 * from the page passes, a quote the page printed in bold passes, a paraphrase
 * does not, and that is the entire line worth drawing: the moment it is fuzzy,
 * a confident model can walk a fact across it.
 */
export function grounded(evidence, pageText) {
  if (typeof evidence !== "string") return false;
  const quote = norm(evidence);
  // Six characters is not a quote, it is a coincidence waiting to happen. "Fee"
  // appears on every page in the estate.
  if (quote.length < 12) return false;
  return norm(pageText).includes(quote);
}

export const KINDS = [
  "ELIGIBILITY",
  "DOCUMENT_REQUIREMENT",
  "CONDITIONAL_REQUIREMENT",
  "ACCEPTED_ALTERNATIVES",
  "CHANNEL",
  "TIMELINE",
  "FEE",
  "OFFICE",
  "HELPLINE",
  "GRIEVANCE",
  "TRACKING",
  "APP",
  "ACTION",
  "DEPENDENCY",
  "EXTERNAL_DEPENDENCY",
  "BLOCKER",
];

const GUJARATI_DIGITS = "૦૧૨૩૪૫૬૭૮૯";

/**
 * `detail` as something downstream can do arithmetic on.
 *
 * A page that says the processing time is ૧ દિવસ gets `{days: "૧"}` back, which
 * is a faithful copy and completely useless to a comparison. The quote keeps the
 * original either way, so converting here loses nothing and saves every consumer
 * from discovering Gujarati numerals on its own.
 */
export function sane(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = typeof v === "string" ? v.replace(/[૦-૯]/g, (d) => GUJARATI_DIGITS.indexOf(d)).slice(0, 300) : v;
  }
  return out;
}

/** lower_snake_case, the id shape both extractors invent subjects and objects in. */
export const id = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || null;
