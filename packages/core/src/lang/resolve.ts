// Leaf imports, not the package root: the root statically imports the seed and
// nothing in this chain needs 5.6MB of government facts to translate a sentence.
import { resolveIntent, type IntentMatch } from "../intent";
import type { GraphData } from "../types";
import { pickService } from "./bedrock";
import { understand } from "./sarvam";

/**
 * The three pass intent chain, in one place.
 *
 * This used to live inside `/api/intents/resolve` and was correct there right
 * up until something other than a browser needed it. The voice layer asks the
 * same question the search box asks, and a second copy of this would be a
 * second place for the confidence floor to drift, a second place for the
 * "below 0.3 means a model read it" convention to be forgotten, and eventually
 * two products that resolve the same sentence differently.
 *
 * Behaviour is unchanged. The route is now a thin wrapper over this.
 *
 * Every pass can only return services that already exist in the graph. Nothing
 * here invents a service, a requirement or an order, and passes 2 and 3 are
 * both optional: with no keys configured this degrades to token overlap, which
 * is worse and never wrong.
 */

export interface DeepIntentResult {
  matches: IntentMatch[];
  /** The English sentence we actually searched on, when we translated one. */
  understoodAs?: string;
  detectedLanguage?: string;
  /** True when a model read the sentence rather than matching words in it. */
  inferred?: boolean;
}

/**
 * How sure pass 1 has to be before the later passes are skipped.
 *
 * `resolveIntent` already refuses anything under 0.3, so everything it returns
 * is worth showing. But at a hundred services a single shared noun clears that
 * bar: "ration card" comes back as Property Card at 0.5, matched on the word
 * card, and there is no ration card service in the graph at all. Returning that
 * as the answer is how the model that could have read the sentence never gets
 * asked.
 *
 * So a weak match no longer stops the chain, it only survives it: if Sarvam and
 * Bedrock both come back with nothing, the weak matches are still what we
 * return, because a labelled guess beats an empty page.
 */
const CONFIDENT = 0.6;

export async function resolveIntentDeeply(graph: GraphData, text: string): Promise<DeepIntentResult> {
  // 1. The citizen's own words against the alias list. Free and auditable, and
  //    the aliases already speak transliterated Gujarati, so translating
  //    "aavak nu dakhlo" first would turn a search key into a sentence that
  //    matches nothing.
  const direct = resolveIntent(graph, text);
  if (direct.some((m) => m.confidence >= CONFIDENT)) return { matches: direct };

  // 2. Sarvam, when their script is not Latin. Translates the question only.
  const understood = await understand(text);
  const spoken = understood.translated
    ? { understoodAs: understood.english, detectedLanguage: understood.detected }
    : {};

  const translated = understood.translated ? resolveIntent(graph, understood.english) : [];
  if (translated.some((m) => m.confidence >= CONFIDENT)) return { matches: translated, ...spoken };

  // 3. Bedrock, for the citizen who described the problem instead of naming the
  //    service. It picks from a list of our ids or says nothing.
  const picked = await pickService(understood.english, services(graph));
  const node = picked ? graph.nodes.find((n) => n.id === picked) : undefined;
  if (!node) return { matches: translated.length ? translated : direct, ...spoken };

  return {
    ...spoken,
    inferred: true,
    matches: [
      {
        goal: node.id,
        name: node.name,
        officialName: node.officialName,
        // Deliberately below the 0.3 the UI treats as a guess. A model reading
        // intent out of a sentence is a suggestion, not a match, and the
        // citizen should be asked to confirm it.
        confidence: 0.25,
        matched: [],
      },
    ],
  };
}

function services(graph: GraphData) {
  return graph.nodes
    .filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name, officialName: n.officialName, aliases: n.aliases }));
}
