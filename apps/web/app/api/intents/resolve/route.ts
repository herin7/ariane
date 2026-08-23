import { resolveIntent } from "@ariane/core";
import { loadLiveGraph, pickService, understand } from "@ariane/core/server";
import { NextResponse } from "next/server";
import type { GraphData } from "@ariane/core";

/**
 * POST /api/intents/resolve
 *
 * Plain language to candidate goals. Returns candidates rather than picking
 * one, because guessing wrong here sends someone to the wrong office.
 *
 * Three passes, cheapest first, and every one of them can only return services
 * that already exist in the graph:
 *
 *   1. The citizen's own words against the alias list. Free and auditable, and
 *      the aliases already speak transliterated Gujarati, so translating
 *      "aavak nu dakhlo" first would turn a search key into a sentence that
 *      matches nothing.
 *   2. Sarvam, when their script is not Latin. Translates the question only.
 *   3. Bedrock, when neither found anything, for the citizen who described the
 *      problem instead of naming the service. It picks from a list of our ids
 *      or says nothing.
 *
 * Each pass stops the moment it has something, which only works because pass 1
 * returns nothing rather than a weak overlap. It did not always: one shared
 * word counted as a match, so "I am 70 and nobody supports me" returned four
 * scholarships and pass 3 was unreachable dead code. The floor lives in
 * resolveIntent, where the mobile app and the search page get it too.
 *
 * Passes 2 and 3 are both optional. With no keys in `.env` this degrades to
 * pass 1, which is worse but never wrong.
 */
export async function POST(request: Request) {
  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const graph = await loadLiveGraph();
  const direct = resolveIntent(graph, text);
  if (direct.length) return NextResponse.json({ query: text, matches: direct });

  const understood = await understand(text);
  const spoken = understood.translated
    ? { understoodAs: understood.english, detectedLanguage: understood.detected }
    : {};

  const translated = understood.translated ? resolveIntent(graph, understood.english) : [];
  if (translated.length) return NextResponse.json({ query: text, matches: translated, ...spoken });

  const picked = await pickService(understood.english, services(graph));
  const node = picked ? graph.nodes.find((n) => n.id === picked) : undefined;

  return NextResponse.json({
    query: text,
    ...spoken,
    matches: node
      ? [
          {
            goal: node.id,
            name: node.name,
            officialName: node.officialName,
            // Deliberately below the 0.3 the UI treats as a guess. A model
            // reading intent out of a sentence is a suggestion, not a match,
            // and the citizen should be asked to confirm it.
            confidence: 0.25,
            matched: [],
          },
        ]
      : [],
    ...(node ? { inferred: true } : {}),
  });
}

function services(graph: GraphData) {
  return graph.nodes
    .filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name, officialName: n.officialName, aliases: n.aliases }));
}
