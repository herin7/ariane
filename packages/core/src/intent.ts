import type { GraphData, GraphNode } from "./types";

/**
 * Intent resolution: plain language in, candidate service keys out.
 *
 * This is the ONLY place a model is ever allowed to touch, and even here it
 * may only choose among services that already exist in the graph. It never
 * invents a service, a requirement or an order. Until Bedrock and Sarvam are
 * wired up this runs on token overlap, which is enough for the five seeded
 * journeys and is honest about being a placeholder.
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
 * it for being well described. Half of one phrase is the bar. "driving licence"
 * is fully covered; one word of five is not.
 */
const NAMED = 0.5;

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
const generic = new WeakMap<GraphData, Set<string>>();

function categoryWords(data: GraphData): Set<string> {
  const cached = generic.get(data);
  if (cached) return cached;

  const seen = new Map<string, number>();
  let services = 0;
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    services++;
    for (const token of new Set(phrasesOf(node).flatMap(tokenise))) {
      seen.set(token, (seen.get(token) ?? 0) + 1);
    }
  }

  const ceiling = Math.max(2, services * 0.1);
  const words = new Set([...seen].filter(([, count]) => count > ceiling).map(([token]) => token));
  generic.set(data, words);
  return words;
}

export function resolveIntent(data: GraphData, text: string, limit = 5): IntentMatch[] {
  const query = tokenise(text);
  if (!query.length) return [];

  const categories = categoryWords(data);
  const matches: IntentMatch[] = [];
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    const scored = score(node, query);
    const confidence = Math.min(1, scored.score / query.length);
    const distinctive = scored.hits.some((h) => !categories.has(h));
    if (confidence >= FLOOR && scored.named >= NAMED && distinctive) {
      matches.push({
        goal: node.id,
        name: node.name,
        officialName: node.officialName,
        confidence,
        matched: scored.hits,
      });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return matches.slice(0, limit);
}

/** Every name this service answers to, lowercased. */
function phrasesOf(node: GraphNode): string[] {
  return [node.name, node.officialName ?? "", ...(node.aliases ?? [])].map((p) => p.toLowerCase()).filter(Boolean);
}

function score(node: GraphNode, query: string[]): { score: number; hits: string[]; named: number } {
  const phrases = phrasesOf(node);
  const vocabulary = new Set(phrases.flatMap(tokenise));

  const hits: string[] = [];
  let total = 0;
  for (const token of query) {
    // An exact alias match is worth more than a shared word like "licence".
    if (phrases.includes(token)) {
      total += 2;
      hits.push(token);
    } else if (vocabulary.has(token)) {
      total += 1;
      hits.push(token);
    }
  }

  // The other half of the question: did the query name this service, or just
  // brush against a word in it. Best phrase wins, so an obscure long official
  // name never drags down a service the citizen called by its short one.
  const asked = new Set(query);
  let named = 0;
  for (const phrase of phrases) {
    const words = tokenise(phrase);
    if (!words.length) continue;
    named = Math.max(named, words.filter((w) => asked.has(w)).length / words.length);
  }

  return { score: total, hits, named };
}
