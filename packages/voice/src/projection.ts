import { officeLine, type CompiledJourney, type IntentMatch, type JourneyStep } from "@ariane/core";
import type { SpeakableFact } from "./types";

/**
 * A compiled journey, cut down to something a person can hear.
 *
 * Two jobs, and they are the same job seen from two sides.
 *
 * §22, the product one. A `CompiledJourney` is a graph: sixty nodes, every
 * source, every quote. Reading that aloud is not an interface, it is a denial
 * of service performed on a human being. So voice gets one question, one next
 * action, a count, and the single most useful missing document, and asks before
 * it lists anything.
 *
 * §14, the safety one. Everything a projection contains, the model may say.
 * Everything it does not contain, the model may not say. `speakableFacts` is
 * that boundary written down: a closed set of government claims, each with the
 * source that proves it, which `guardrails.ts` then checks the model's actual
 * words against. "Please don't hallucinate" is not a control. A list of the
 * only sentences that are true is.
 */

export interface VoiceQuestion {
  id: string;
  prompt: string;
  /** Present for a select, so the model offers the graph's words, not its own. */
  options?: string[];
  inputType: string;
}

export interface VoiceJourney {
  status: "NEEDS_INPUT" | "READY";
  service: { id: string; name: string };
  jurisdiction: string;
  /** One sentence. Counts, never lists. */
  summary: string;
  /** The single question worth asking next, or none when nothing is pending. */
  nextQuestion?: VoiceQuestion;
  nextBestAction?: { stepId: string; title: string; whatToDo?: string };
  documents: {
    readyCount: number;
    neededCount: number;
    /** The first thing they do not have. Progressive disclosure starts here. */
    mostImportantMissing?: string;
    /** Names only, capped. The model asks before reading them out. */
    needed: string[];
  };
  office?: { name: string; line: string };
  stepsRemaining: number;
  /** True when no person has read the pages behind this. The model must say so. */
  unverified: boolean;
  speakableFacts: SpeakableFact[];
}

/**
 * How many names of anything cross into a voice payload.
 *
 * Not a display limit, a payload limit. Six document names is already more than
 * anyone holds in their head off a phone call, and the count beside them is
 * exact, so nothing is being hidden: the model says "four documents" truthfully
 * and offers to read them.
 */
const SPOKEN_LIST_CAP = 6;

const firstSource = (item: { sources?: { sourceId: string }[] }): string | undefined =>
  item.sources?.[0]?.sourceId;

export function projectJourney(journey: CompiledJourney): VoiceJourney {
  const facts: SpeakableFact[] = [];
  const add = (fact: SpeakableFact) => {
    if (fact.text.trim()) facts.push(fact);
  };

  const steps = journey.orderedSteps.filter((s) => s.state !== "SATISFIED" && s.state !== "COMPLETED");
  const next = steps[0];
  const question = journey.outstandingQuestions[0];

  // The service's own name is a government claim like any other: it is the
  // name on the page, and it is the first thing the model will say.
  add({ claimId: `service:${journey.goal}`, text: journey.goalName, sourceId: undefined });

  if (next) addStepFacts(next, add);

  // Documents, by name only. Fees and timelines ride on the step, not here.
  for (const doc of journey.documentsNeeded.slice(0, SPOKEN_LIST_CAP)) {
    add({ claimId: `document:${doc.nodeId}`, text: doc.name, sourceId: firstSource(doc) });
  }

  const office = journey.offices[0];
  if (office) {
    add({ claimId: `office:${office.nodeId}`, text: officeLine(office), sourceId: firstSource(office) });
  }

  const channel = journey.digitalChannels[0];
  if (channel?.url) {
    add({ claimId: `channel:${channel.nodeId}`, text: `${channel.name} ${channel.url}`, sourceId: firstSource(channel) });
  }

  for (const blocker of journey.blockers.slice(0, 2)) {
    add({ claimId: `blocker:${blocker.nodeId}`, text: `${blocker.title}. ${blocker.reason}`, sourceId: firstSource(blocker) });
  }

  const { summary } = journey;
  return {
    status: question ? "NEEDS_INPUT" : "READY",
    service: { id: journey.goal, name: journey.goalName },
    jurisdiction: journey.jurisdiction.name,
    summary:
      `${summary.stepsRemaining} step${summary.stepsRemaining === 1 ? "" : "s"} left, ` +
      `${summary.documentsToPrepareCount} document${summary.documentsToPrepareCount === 1 ? "" : "s"} to prepare` +
      (summary.physicalVisits ? `, ${summary.physicalVisits} office visit${summary.physicalVisits === 1 ? "" : "s"}` : "") +
      (summary.blockerCount ? `, ${summary.blockerCount} thing${summary.blockerCount === 1 ? "" : "s"} in the way` : ""),
    nextQuestion: question
      ? {
          id: question.field,
          prompt: question.label,
          inputType: question.inputType,
          ...(question.options ? { options: question.options.map((o) => o.label).slice(0, SPOKEN_LIST_CAP) } : {}),
        }
      : undefined,
    nextBestAction: next
      ? { stepId: next.nodeId, title: next.title, whatToDo: next.whatToDo ?? next.description }
      : undefined,
    documents: {
      readyCount: summary.documentsReadyCount,
      neededCount: summary.documentsToPrepareCount,
      mostImportantMissing: journey.documentsNeeded[0]?.name,
      needed: journey.documentsNeeded.slice(0, SPOKEN_LIST_CAP).map((d) => d.name),
    },
    office: office ? { name: office.name, line: officeLine(office) } : undefined,
    stepsRemaining: summary.stepsRemaining,
    /**
     * One unread page anywhere in the path makes the path unread.
     *
     * The screen can afford to label each step. A voice cannot say "this step
     * was machine extracted and the next one was not" without the caller
     * losing the thread, so the caveat is hoisted to the journey and said once,
     * up front. Erring towards saying it more often than strictly needed is the
     * safe direction of that trade.
     */
    unverified: steps.some((s) => s.machineExtracted),
    speakableFacts: facts,
  };
}

/** Everything sayable about one step, for `explain_step`. */
export function projectStep(journey: CompiledJourney, stepId: string): VoiceJourney | undefined {
  const step = journey.orderedSteps.find((s) => s.nodeId === stepId);
  if (!step) return undefined;

  const facts: SpeakableFact[] = [];
  const add = (fact: SpeakableFact) => {
    if (fact.text.trim()) facts.push(fact);
  };
  addStepFacts(step, add);
  for (const doc of step.documentsNeeded.slice(0, SPOKEN_LIST_CAP)) {
    add({ claimId: `document:${doc.nodeId}`, text: doc.name, sourceId: firstSource(doc) });
  }
  for (const channel of step.channels.slice(0, 2)) {
    add({
      claimId: `channel:${channel.nodeId}`,
      text: [channel.name, channel.url].filter(Boolean).join(" "),
      sourceId: firstSource(channel),
    });
  }
  for (const office of step.offices.slice(0, 2)) {
    add({ claimId: `office:${office.nodeId}`, text: officeLine(office), sourceId: firstSource(office) });
  }
  for (const escalation of step.escalation.slice(0, 2)) {
    add({
      claimId: `escalation:${escalation.nodeId}`,
      text: [escalation.name, escalation.url, escalation.phoneNumbers?.join(" ")].filter(Boolean).join(" "),
      sourceId: firstSource(escalation),
    });
  }

  return {
    status: "READY",
    service: { id: journey.goal, name: journey.goalName },
    jurisdiction: journey.jurisdiction.name,
    summary: step.title,
    nextBestAction: { stepId: step.nodeId, title: step.title, whatToDo: step.whatToDo ?? step.description },
    documents: {
      readyCount: step.documentsReady.length,
      neededCount: step.documentsNeeded.length,
      mostImportantMissing: step.documentsNeeded[0]?.name,
      needed: step.documentsNeeded.slice(0, SPOKEN_LIST_CAP).map((d) => d.name),
    },
    office: step.offices[0] ? { name: step.offices[0].name, line: officeLine(step.offices[0]) } : undefined,
    stepsRemaining: 1,
    unverified: Boolean(step.machineExtracted),
    speakableFacts: facts,
  };
}

/**
 * Fee, timeline, form number, eligibility, what to do.
 *
 * Every one of these is a government claim carrying its own source ref off the
 * node, so each becomes its own fact with its own `sourceId`. Flattening them
 * into one paragraph would mean one citation standing behind five claims, which
 * is how a fee ends up proved by a page about a deadline.
 */
function addStepFacts(step: JourneyStep, add: (fact: SpeakableFact) => void): void {
  const sourceId = firstSource(step);
  const flag = step.machineExtracted ? { machineExtracted: true } : {};
  const claim = (kind: string, text: string | undefined) => {
    if (text) add({ claimId: `${kind}:${step.nodeId}`, text, sourceId, ...flag });
  };

  claim("step", step.title);
  claim("whatToDo", step.whatToDo ?? step.description);
  claim("fee", step.fee);
  claim("timeline", step.timeline);
  claim("form", step.formNumber);
  claim("output", step.expectedOutput);
  for (const [i, line] of (step.eligibility ?? []).slice(0, 3).entries()) {
    add({ claimId: `eligibility:${step.nodeId}:${i}`, text: line, sourceId, ...flag });
  }
  for (const [i, line] of (step.couldBlock ?? []).slice(0, 3).entries()) {
    add({ claimId: `couldBlock:${step.nodeId}:${i}`, text: line, sourceId, ...flag });
  }
}

/**
 * Candidate services from `resolveIntent`, as something to say.
 *
 * Three, never more. The web search page settled on the same number for the
 * same reason: past the third the product has stopped answering and started
 * making the citizen do the work, and out loud that arrives even sooner.
 */
export function projectMatches(matches: IntentMatch[]): {
  candidates: { serviceId: string; name: string; because: string }[];
  speakableFacts: SpeakableFact[];
} {
  const top = matches.slice(0, 3);
  return {
    candidates: top.map((m) => ({
      serviceId: m.goal,
      name: m.name,
      because: m.matched.length
        ? `you said ${m.matched.join(", ")}`
        : "read between your words rather than off them, so check this is what you meant",
    })),
    speakableFacts: top.map((m) => ({ claimId: `service:${m.goal}`, text: m.name })),
  };
}
