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
  /** 0 to 1. Anything under 0.3 is a guess and the UI should say so. */
  confidence: number;
  /** Which words in the query actually matched. Shown so the citizen can correct us. */
  matched: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "i", "my", "me", "want", "need", "to", "get", "for", "how", "do", "can",
  "is", "of", "in", "on", "at", "apply", "new", "make", "want to", "please", "help",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function resolveIntent(data: GraphData, text: string, limit = 5): IntentMatch[] {
  const query = tokenise(text);
  if (!query.length) return [];

  const matches: IntentMatch[] = [];
  for (const node of data.nodes) {
    if (node.type !== "SERVICE") continue;
    const scored = score(node, query);
    if (scored.hits.length) {
      matches.push({
        goal: node.id,
        name: node.name,
        officialName: node.officialName,
        confidence: Math.min(1, scored.score / query.length),
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
