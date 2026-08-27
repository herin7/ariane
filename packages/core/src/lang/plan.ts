import { resolveIntent } from "../intent";
import type { GraphData } from "../types";
import { bedrockChat, type BedrockCall, type ServiceChoice } from "./bedrock";

/**
 * One sentence about a life event, several services out.
 *
 * `pickService` answers "which service is this", which is the right question for
 * a citizen who names one. It is the wrong question for "I want to start a
 * company", which is five or six services and an order, and answering it with
 * the single best match is how somebody registers a company and hears about the
 * shop and establishment licence from an inspector.
 *
 * The safety property is identical to `pickService` and is the reason this file
 * is allowed to exist: the model is handed the ids that are already in the
 * graph and every id it returns is checked against that list before anybody
 * believes it. It cannot invent a service, and it is never asked what a service
 * requires, costs or where it happens - `plan.ts` compiles that from rows.
 *
 * What is genuinely new is the questions. A plan for a company depends on
 * whether there will be a shop, whether food is sold, whether anyone is hired;
 * nobody can answer that from a sentence and guessing produces a checklist with
 * two licences on it that this person will never need. So the model may ask, in
 * the citizen's own terms, and the answers come back into the next call.
 *
 * The graph asks its own questions too, derived from conditional edges, and
 * those are better because they are provably load-bearing. These are the ones
 * that decide which journey to open at all, which is upstream of any edge.
 */

export interface PlanQuestion {
  /** Stable within a plan, so an answer can be posted back against it. */
  id: string;
  label: string;
  help?: string;
  options: { value: string; label: string }[];
  /** True when more than one option can be true at once. */
  multi?: boolean;
}

export interface PlannedGoals {
  /** What the citizen is trying to do, in their words, for the page heading. */
  title?: string;
  /** Ids that exist in the graph. Possibly empty. */
  goals: string[];
  /** What we would need to know to be sure this is the right set. */
  questions: PlanQuestion[];
  /** True when a model chose these rather than word overlap. */
  inferred: boolean;
}

const SYSTEM = [
  "You plan Indian government paperwork. A citizen describes something they want to do; you say which government services that actually involves.",
  "",
  "You may only answer with ids from the list you are given. Never invent one, never answer with a service that is not listed, and never name a requirement, a fee, an office or a document: those come from elsewhere and you do not know them.",
  "",
  "Pick every service the citizen plainly needs and no more. Two to six is usual for a life event; one is correct when they named a single service. A service they might need only under a condition you were not told about does not go in the list - ask about it instead.",
  "",
  "You may ask up to three questions, and only questions whose answer changes which services apply. Do not ask for a name, an address, a document number or anything a form would ask; you are choosing services, not filling one in. Ask nothing if the sentence is already unambiguous.",
  "",
  'Answer with JSON and nothing else: {"title": string, "services": [string], "questions": [{"id": string, "label": string, "options": [{"value": string, "label": string}], "multi": boolean}]}',
  "",
  "title is what the citizen is doing, six words at most, in their own words.",
  "Every question needs at least two options and every option needs a short plain label. A yes/no question has exactly two.",
].join("\n");

/** How many services a plan may hold. Past this it stops being a plan. */
const MAX_GOALS = 8;
const MAX_QUESTIONS = 3;

/**
 * Plan a life event into goals the graph can compile.
 *
 * Falls back to token overlap when there is no model or the model says nothing
 * useful, which degrades a plan into "the one service your words matched" - the
 * behaviour the product had before this file, and never wrong, only thin.
 */
export async function planGoals(
  graph: GraphData,
  text: string,
  answers: Record<string, string | string[]> = {},
  options: BedrockCall = {},
): Promise<PlannedGoals> {
  const query = text.trim();
  if (!query) return { goals: [], questions: [], inferred: false };

  const candidates = servicesOf(graph);
  const answered = Object.entries(answers)
    .map(([id, value]) => `- ${id}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");

  const reply = await bedrockChat(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Services available:\n${catalogue(candidates)}`,
          "",
          `Citizen said: ${query}`,
          answered ? `\nThey have already answered:\n${answered}` : "",
          "\nWhich services, and what do you still need to know?",
        ].join("\n"),
      },
    ],
    // Longer than an intent call, because this one writes a list and questions,
    // and a plan cut off mid-JSON is a plan with no services in it.
    { maxTokens: 1500, timeoutMs: 20_000, ...options },
  );

  const parsed = parse(reply);
  const goals = keepReal(parsed?.services, candidates);

  // No model, a refused call, or every id hallucinated. Word overlap is the
  // floor here exactly as it is in `resolveIntentDeeply`: worse, and never wrong.
  if (!goals.length) {
    const matched = resolveIntent(graph, query, 3).map((m) => m.goal);
    return { goals: matched, questions: [], inferred: false };
  }

  return {
    ...(parsed?.title ? { title: String(parsed.title).slice(0, 80) } : {}),
    goals,
    // Answered questions are not asked again. The model is told what was
    // answered and mostly gets this right on its own; mostly is not a guarantee
    // and re-asking a question somebody just answered is the rudest possible bug.
    questions: keepAskable(parsed?.questions).filter((q) => !(q.id in answers)),
    inferred: true,
  };
}

// ---------------------------------------------------------------------------

function servicesOf(graph: GraphData): ServiceChoice[] {
  return graph.nodes
    .filter((n) => n.type === "SERVICE")
    .map((n) => ({ id: n.id, name: n.name, officialName: n.officialName, aliases: n.aliases }));
}

function catalogue(candidates: readonly ServiceChoice[]): string {
  return candidates
    .map((c) => {
      const also = [c.officialName, ...(c.aliases ?? [])].filter(Boolean).slice(0, 6).join(", ");
      return also ? `${c.id} - ${c.name} (also called: ${also})` : `${c.id} - ${c.name}`;
    })
    .join("\n");
}

/**
 * The JSON out of a reply that may have a sentence or a fence around it.
 *
 * Models in this catalogue think out loud, and refusing an otherwise correct
 * plan because it arrived wrapped in "Here you go:" is a worse product. The
 * substance is checked afterwards; this only finds the object.
 */
function parse(reply: string | undefined): Record<string, unknown> | undefined {
  if (!reply) return undefined;
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(reply.slice(start, end + 1));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Ids that are really in the graph, in the order the model gave them. */
function keepReal(services: unknown, candidates: readonly ServiceChoice[]): string[] {
  if (!Array.isArray(services)) return [];
  const byId = new Map(candidates.map((c) => [c.id.toLowerCase(), c.id]));
  const out: string[] = [];
  for (const value of services) {
    if (typeof value !== "string") continue;
    const wanted = value.trim().replace(/[^\w:]/g, "").toLowerCase();
    const id = byId.get(wanted) ?? byId.get(`service:${wanted}`);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= MAX_GOALS) break;
  }
  return out;
}

/** Questions with enough shape to render and answer. The rest are dropped. */
function keepAskable(questions: unknown): PlanQuestion[] {
  if (!Array.isArray(questions)) return [];
  const out: PlanQuestion[] = [];
  for (const raw of questions) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    const id = typeof q.id === "string" ? q.id.trim().slice(0, 60) : "";
    const label = typeof q.label === "string" ? q.label.trim().slice(0, 160) : "";
    const options = Array.isArray(q.options)
      ? q.options
          .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
          .map((o) => ({
            value: typeof o.value === "string" ? o.value.trim().slice(0, 60) : "",
            label: typeof o.label === "string" ? o.label.trim().slice(0, 80) : "",
          }))
          .filter((o) => o.value && o.label)
          .slice(0, 6)
      : [];
    // A question with one option is not a question, it is an announcement.
    if (!id || !label || options.length < 2) continue;
    out.push({
      id,
      label,
      ...(typeof q.help === "string" && q.help.trim() ? { help: q.help.trim().slice(0, 200) } : {}),
      options,
      ...(q.multi === true ? { multi: true } : {}),
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}
