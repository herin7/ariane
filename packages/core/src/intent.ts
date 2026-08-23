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

export function resolveIntent(data: GraphData, text: string, limit = 5): IntentMatch[] {
  const query = tokenise(text);
  if (!query.length) return [];

  const matches: IntentMatch[] = [];
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    const scored = score(node, query);
    const confidence = Math.min(1, scored.score / query.length);
    if (confidence >= FLOOR) {
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

function score(node: GraphNode, query: string[]): { score: number; hits: string[] } {
  const phrases = [node.name, node.officialName ?? "", ...(node.aliases ?? [])].map((p) => p.toLowerCase());
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
  return { score: total, hits };
}
