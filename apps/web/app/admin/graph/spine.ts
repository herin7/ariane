import type { CompiledJourney } from "@ariane/core";
import type { Edge, Node } from "@xyflow/react";

/**
 * The person the graph is about, drawn to the left of everything it asks of them.
 *
 * A compiled journey starts at a service and fans out into documents, offices
 * and proofs. Nobody is anywhere in it. So the picture reads as a diagram of
 * paperwork when it is actually a diagram of one citizen's afternoon, and the
 * single most important fact on the screen — that a person is standing in
 * India, in Gujarat, in a district, and that those three facts are what decide
 * which desk they end up at — is not on the screen at all.
 *
 * These nodes are a presentation layer and nothing else.
 *
 *   - They are not in the graph, are not written back to it, and carry ids in
 *     a `spine:` namespace that no seed bundle can mint.
 *   - They cite nothing, because they are not claims about the government. They
 *     are claims about who is looking, and the inspector says so when clicked.
 *   - No edge here is a government fact either. A citizen "is" a resident of
 *     Gujarat; that is a description, not a rule we found on a page.
 *
 * The one thing they do carry that IS a fact from the data: which government
 * runs the service. A central service hangs off the Government of India rather
 * than off Gujarat, and the reason it does is `authorityLevel` on the node, not
 * anything this file knows about passports.
 */

export const SPINE_PREFIX = "spine:";
export const isSpine = (id: string) => id.startsWith(SPINE_PREFIX);

/** Pushed left of the goal, which `place` puts at x=0. */
const COLUMN = 250;
const SIZE = 132;

export interface Citizen {
  country: string;
  state: string;
  district: string;
}

export function spine(journey: CompiledJourney, who: Citizen): { nodes: Node[]; edges: Edge[] } {
  const goalNode = journey.graph.nodes.find((n) => n.id === journey.goal);
  const authority = goalNode?.metadata?.authorityLevel;

  // Whose service this is, taken off the node. The chain ends at the
  // government that actually runs the thing, so a central service visibly
  // leaves the state chain instead of pretending to be Gujarat's.
  const central = authority === "CENTRAL";

  const chain = [
    { id: "you", label: "You", sub: "the person asking", kind: "human" },
    { id: "india", label: `${who.country}n citizen`, sub: "Constitution of India", kind: "tier" },
    ...(central
      ? [{ id: "goi", label: "Government of India", sub: "runs this one", kind: "authority" }]
      : [
          { id: "state", label: `${who.state} resident`, sub: `Government of ${who.state}`, kind: "tier" },
          { id: "district", label: `${who.district} district`, sub: "your jurisdiction", kind: "tier" },
        ]),
  ];

  // Rightmost link sits at x = -COLUMN, so the goal is the next thing along.
  const originX = -COLUMN * chain.length;

  const nodes: Node[] = chain.map((link, i) => ({
    id: SPINE_PREFIX + link.id,
    position: { x: originX + i * COLUMN, y: 0 },
    data: { label: `${link.label}\n${link.sub}` },
    className: `spine-node spine-${link.kind}`,
    style: {
      width: SIZE,
      height: SIZE,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center" as const,
      whiteSpace: "pre-line" as const,
      fontSize: 11,
      lineHeight: 1.3,
      padding: 10,
    },
  }));

  const labels = central
    ? ["you are", "this service is theirs"]
    : ["you are", "which makes you", "which puts you in"];

  const edges: Edge[] = chain.slice(1).map((link, i) => ({
    id: `${SPINE_PREFIX}edge:${chain[i]!.id}-${link.id}`,
    source: SPINE_PREFIX + chain[i]!.id,
    target: SPINE_PREFIX + link.id,
    label: labels[i],
    labelStyle: { fontSize: 9, fill: "var(--faint)" },
    labelBgStyle: { fill: "var(--bg)" },
    // Dashed everywhere, because none of it was read off a government page and
    // a solid line in this picture means "we can show you where this came from".
    style: { strokeWidth: 1.5, stroke: "var(--accent)", strokeDasharray: "3 4", opacity: 0.7 },
  }));

  edges.push({
    id: `${SPINE_PREFIX}edge:asks`,
    source: SPINE_PREFIX + chain[chain.length - 1]!.id,
    target: journey.goal,
    label: central ? "and this is what they ask" : "and this is what you asked for",
    labelStyle: { fontSize: 9, fill: "var(--faint)" },
    labelBgStyle: { fill: "var(--bg)" },
    animated: true,
    style: { strokeWidth: 2, stroke: "var(--thread)" },
  });

  return { nodes, edges };
}

/**
 * What the inspector shows when one of these is clicked.
 *
 * Every other box in the picture answers "where did this come from" with a
 * government page. These have to answer it honestly with "they did not".
 */
export const SPINE_NOTE =
  "This box is not from the graph. It is who you are, drawn so the picture starts with a person rather than with paperwork. Nothing here was read off a government page, which is why the lines around it are dashed.";
