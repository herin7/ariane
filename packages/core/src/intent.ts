import type { GraphData, GraphNode } from "./types";

/**
 * Intent resolution: plain language in, candidate service keys out.
 *
 * This is the ONLY place a model is ever allowed to touch, and even here it
 * may only choose among services that already exist in the graph. It never
 * invents a service, a requirement or an order.
 *
 * Nothing in this file calls a model. This is pass one: token overlap, free,
 * instant and auditable, and it runs first precisely so the expensive passes
 * only see what it could not answer. Sarvam and Bedrock live behind
 * `/api/intents/resolve` and are reached only when this returns nothing
 * confident.
 *
 * Know what that costs. `pnpm intent:eval` scores this column 3 out of 15 on
 * citizens describing a problem rather than naming a service, against 12 to 14
 * with the model. Overlap is the floor, not the product. It is here because a
 * floor that is right every time is worth more than a guess.
 */

export interface IntentMatch {
  goal: string;
  name: string;
  officialName?: string;
  /**
   * 0 to 1. Token overlap never returns anything under 0.3, so a value below
   * that came from a model reading the sentence and the UI should say so.
   */
  confidence: number;
  /** Which words in the query actually matched. Shown so the citizen can correct us. */
  matched: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "i", "my", "me", "want", "need", "to", "get", "for", "how", "do", "can",
  "is", "of", "in", "on", "at", "apply", "new", "make", "want to", "please", "help",
]);

/**
 * Words that are in a service's name but are never the reason it is the answer.
 *
 * "I am 70 and nobody supports me" came back as "IT/ITeS and R&D Support",
 * confidence 0.4, because it shares "and" and "support" with it. A conjunction
 * is in the name of a hundred government services and in the middle of every
 * sentence a citizen types.
 *
 * Deliberately not a stopword. A stopword leaves the query, and leaving the
 * query shrinks the denominator that FLOOR divides by, so dropping "and" would
 * *raise* our confidence in every sentence containing one. The citizen still
 * typed the word and we still did not account for it. It stays counted and
 * stops being evidence.
 */
const NOT_EVIDENCE = new Set(["and", "or", "amp", "cum"]);

/**
 * Unicode aware on purpose, marks included.
 *
 * Splitting on `[^a-z0-9]` quietly deleted every Gujarati character, so
 * "આવકનો દાખલો" tokenised to nothing. Fixing that with `\p{L}` was still wrong:
 * a Gujarati vowel sign is a mark, not a letter, so "આવકનો" came apart into
 * "આવકન" and a dropped "ો". It matched anyway, because the aliases came apart
 * the same way, which is the worst kind of working. `\p{M}` keeps words whole.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}']+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Below this a match is noise, not a guess, and saying nothing is better.
 *
 * One shared word used to be enough to be a match. "I am 70 and nobody
 * supports me" scored 0.2 against a scholarship because "supports" is in its
 * name, and four services nobody asked about came back looking like answers.
 * Worse, upstream reads a non empty list as "solved" and stops, so a citizen
 * describing a problem in their own words never reached the model that could
 * actually read it.
 *
 * 0.3 is the line the rest of the codebase already calls a guess. Measured
 * against the seeded services it sits in open space: every query that names
 * its service scores 0.33 or better even buried in nine words of politeness,
 * and every junk overlap scores 0.29 or less.
 */
const FLOOR = 0.3;

/**
 * How much of the service's own name the query has to account for.
 *
 * FLOOR alone only asks whether the query was used up, which stops being
 * evidence once the graph is large. "passport renewal appointment" scores 0.33
 * against "Gujarat Veterinary Council registration and renewal", because one
 * word of three matched, and 0.33 is a passing grade. It matched "renewal". A
 * citizen asking about a passport is not asking about a veterinary council.
 *
 * So the service has to be accounted for too, measured against its best single
 * phrase rather than the union of its aliases: a service with nine aliases is
 * not harder to name than one with two, and dividing by the union would punish
 * it for being well described.
 *
 * More than half of one phrase, and the "more than" is load bearing. At half,
 * one word of a two word name is enough, and the corpus grew a service called
 * "License Renewal", so "passport renewal appointment" came back with it: one
 * word of two, 0.5, a pass. A citizen asking about a passport is not asking
 * about a licence. One word only names a service whose name is one word, which
 * is what "pf" and "varshai" are.
 */
const NAMED = 0.5;

/**
 * Enough of a stemmer to count "certificate" and "certificates" as one word.
 *
 * Only ever used for counting, never for matching, so the cost of getting it
 * wrong is a tie broken in the wrong order and not a service that cannot be
 * found. Without it "Miscellaneous Certificates" was the rarest thing in the
 * graph, because it is the only service that spells the word with an s.
 */
const stem = (token: string): string => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token);

/**
 * How many services a word may appear in and still count as having named one.
 *
 * NAMED is satisfied by half of a two word name, and half of "Caste Certificate"
 * is "certificate". So "varsai certificate" came back with the caste and the
 * domicile certificate, which is the same failure as the veterinary council in a
 * politer disguise: the query named a category, not a service.
 *
 * The fix is not a stoplist of generic government words. That list is endless
 * and different in every state, and "certificate" is only generic *here* because
 * thirty services in this graph are one. So ask the graph. A word in a tenth of
 * the catalogue is a category; a word in two services is a name.
 */
const generic = new WeakMap<GraphData, { counts: Map<string, number>; categories: Set<string> }>();

function vocabularyOf(data: GraphData): { counts: Map<string, number>; categories: Set<string> } {
  const cached = generic.get(data);
  if (cached) return cached;

  const counts = new Map<string, number>();
  let services = 0;
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    services++;
    for (const token of new Set(phrasesOf(node).flatMap(tokenise).map(stem))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const ceiling = Math.max(2, services * 0.1);
  const categories = new Set([...counts].filter(([, count]) => count > ceiling).map(([token]) => token));
  const built = { counts, categories };
  generic.set(data, built);
  return built;
}

export function resolveIntent(data: GraphData, text: string, limit = 5): IntentMatch[] {
  const query = tokenise(text);
  if (!query.length) return [];

  const { counts, categories } = vocabularyOf(data);
  const matches: IntentMatch[] = [];
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    const scored = score(node, query);
    const confidence = Math.min(1, scored.score / query.length);
    const distinctive = scored.hits.some((h) => !categories.has(stem(h)));
    if (confidence >= FLOOR && scored.named > NAMED && distinctive) {
      matches.push({
        goal: node.id,
        name: node.name,
        officialName: node.officialName,
        confidence,
        matched: scored.hits,
      });
    }
  }

  // Confidence first, then how rare the words that matched were.
  //
  // Six services tie at 0.50 for "varsai certificate": five certificates that
  // matched the word "certificate" and Varshai, which matched "varshai".
  // Alphabetical order put Varshai sixth, off the end of a list of five, and
  // the citizen who typed the one word that identified their service got the
  // five services that ignored it. `categories` cannot break this tie: at 222
  // services "certificate" is in fifteen of them, well under the tenth of the
  // catalogue that makes a word generic, so it counts as distinctive and so
  // does "varshai". Rarity is a scale where that was a threshold. One service
  // in the graph says varshai and fifteen say certificate, so varshai is
  // fifteen times more of an answer.
  const rarity = (m: IntentMatch) => m.matched.reduce((sum, h) => sum + 1 / (counts.get(stem(h)) ?? 1), 0);
  matches.sort((a, b) => b.confidence - a.confidence || rarity(b) - rarity(a) || a.name.localeCompare(b.name));
  return matches.slice(0, limit);
}

/** Every name this service answers to, lowercased. */
function phrasesOf(node: GraphNode): string[] {
  return [node.name, node.officialName ?? "", ...(node.aliases ?? [])].map((p) => p.toLowerCase()).filter(Boolean);
}

/**
 * Shortest word where one edit is a spelling and not a different word.
 *
 * Gujarati has no one English spelling. The state itself writes વારસાઈ as
 * "varsai" on the collectorate page and "varshai" in the url, and a citizen
 * types whichever they saw last. Exact matching answered nothing for "varsai
 * certificate", which is one of the most asked for certificates in the graph.
 *
 * Six is where it stops being dangerous. "pan" and "pen" are one edit apart and
 * are not the same thing; "varsai" and "varshai" are one edit apart and are.
 */
const NEAR = 6;

/** True if one insertion, deletion or substitution turns a into b. */
function near(a: string, b: string): boolean {
  if (a.length < NEAR || b.length < NEAR) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    // Consume from the longer side on a length difference, both on a swap.
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function score(node: GraphNode, query: string[]): { score: number; hits: string[]; named: number } {
  const phrases = phrasesOf(node);
  const vocabulary = [...new Set(phrases.flatMap(tokenise))];

  const hits: string[] = [];
  // The service's own words that the query reached, however it reached them.
  const asked = new Set<string>();
  let total = 0;
  for (const token of query) {
    if (NOT_EVIDENCE.has(token)) continue;
    // An exact alias match is worth more than a shared word like "licence".
    if (phrases.includes(token)) {
      total += 2;
      hits.push(token);
      asked.add(token);
      continue;
    }
    if (vocabulary.includes(token)) {
      total += 1;
      hits.push(token);
      asked.add(token);
      continue;
    }
    // Recorded as the word the service uses, not the word the citizen typed,
    // so the UI shows them how we read it and they can say we read it wrong.
    const close = vocabulary.find((word) => near(word, token));
    if (close) {
      total += 1;
      hits.push(close);
      asked.add(close);
    }
  }

  // The other half of the question: did the query name this service, or just
  // brush against a word in it. Best phrase wins, so an obscure long official
  // name never drags down a service the citizen called by its short one.
  let named = 0;
  for (const phrase of phrases) {
    const words = tokenise(phrase);
    if (!words.length) continue;
    named = Math.max(named, words.filter((w) => asked.has(w)).length / words.length);
  }

  return { score: total, hits, named };
}
