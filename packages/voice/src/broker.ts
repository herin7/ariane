import {
  GoalNotFoundError,
  JurisdictionNotFoundError,
  compileJourney,
  compilePlan,
  type CitizenContext,
  type CompiledJourney,
  type GraphData,
} from "@ariane/core";
import { languageTag } from "./agent";
import { checkInput } from "./guardrails";
import { LIMITS, TOOL_POLICY } from "./policy";
import { projectJourney, projectMatches, projectPlan, projectStep } from "./projection";
import { TOOL_ARGUMENTS, isVoiceTool } from "./schemas";
import type { VoiceSessions } from "./session";
import type { PreferenceKey, VoiceStore } from "./store";
import { emit } from "./telemetry";
import { atLeast, type RefusalCode, type SpeakableFact, type ToolCall, type ToolResult, type VoiceSession, type VoiceToolName } from "./types";

/**
 * The security boundary. §8.
 *
 * Everything the model proposes lands here and nothing gets past it on the
 * strength of having been proposed. The order is fixed and every step is
 * deterministic:
 *
 *   budget → loop → known tool → allowed on this session → identity level
 *          → size → schema → handler (timed out) → projection → leak check
 *
 * Two properties are worth stating plainly, because they are what make the
 * red-team suite pass rather than the prompt being persuasive:
 *
 * §9. No handler below reads a citizen id from a tool argument. There is no
 * argument that carries one and no schema that permits one. Identity comes off
 * `session.citizenId`, which was resolved from the transport before the model
 * existed and which the model cannot see, name or write. A caller who dictates
 * somebody else's id is a caller who said a number out loud.
 *
 * §30. The only thing this file reaches for government facts is the compiled
 * graph. There is no corpus path, no fetch, no scrape directory, no PDF. The
 * private corpus is not on the live voice path and there is no code here that
 * could put it there.
 */

export interface BrokerConfig {
  sessions: VoiceSessions;
  store: VoiceStore;
  /** The live graph, or the seed. `loadLiveGraph` from `@ariane/core/server`. */
  graph: () => Promise<GraphData>;
  /**
   * The three pass intent chain, injected rather than imported, so this package
   * does not drag Supabase and the seed into every test that wants to check a
   * refusal code. `resolveIntentDeeply` in production.
   */
  resolveNeed: (graph: GraphData, text: string) => Promise<{ matches: { goal: string; name: string; officialName?: string; confidence: number; matched: string[] }[] }>;
  /**
   * A life event to the goals it opens. `planGoals` in production, injected for
   * the same reason as `resolveNeed`. Optional: without it `build_plan` refuses
   * rather than falling back to one service and calling it a plan, because a
   * plan that is four services short is the failure this tool exists against.
   */
  planNeed?: (graph: GraphData, text: string) => Promise<{ goals: string[]; title?: string }>;
  now?: () => number;
}

interface Handled {
  data: Record<string, unknown>;
  grounding: SpeakableFact[];
  /** Set when the handler changed the session. Saved once, by `execute`. */
  touched?: boolean;
}

export class VoiceBroker {
  private readonly now: () => number;
  /**
   * Last call signature per session, for loop detection.
   *
   * Known limit: in-process, so a caller spread across two web instances gets
   * two loop counters. `LIMITS.maxToolCalls` is still the hard ceiling either
   * way; move this onto the session row before running more than one instance.
   */
  private readonly recent = new Map<string, { signature: string; count: number }>();

  constructor(private readonly config: BrokerConfig) {
    this.now = config.now ?? Date.now;
  }

  /**
   * One proposed tool call, from proposal to safe result.
   *
   * Never throws. A voice interface with an unhandled rejection in it is a
   * citizen listening to silence, so every path returns something the model can
   * say out loud, including the paths where the answer is that we will not.
   */
  async execute(session: VoiceSession, call: ToolCall): Promise<ToolResult> {
    const refuse = async (code: RefusalCode, speak: string, invalid = true): Promise<ToolResult> => {
      if (invalid) session.budget.invalidToolCalls += 1;
      session.budget.consecutiveFailures += 1;
      await this.config.sessions.save(session);
      emit("voice.tool.failure", session.id, { tool: call.name, code }, session.callerHash);
      return { ok: false, code, speak };
    };

    emit("voice.tool.call", session.id, { tool: call.name }, session.callerHash);

    // -- budget, before anything is parsed --------------------------------
    session.budget.toolCalls += 1;
    if (session.budget.toolCalls > LIMITS.maxToolCalls) {
      return refuse("BUDGET_EXCEEDED", "We have covered a lot. Let me summarise where you are and we can pick this up again.", false);
    }
    if (session.budget.invalidToolCalls >= LIMITS.maxInvalidToolCalls) {
      return refuse("BUDGET_EXCEEDED", "Something keeps going wrong on my side. Let me start again from what you need.", false);
    }
    if (session.budget.consecutiveFailures >= LIMITS.maxConsecutiveFailures) {
      await this.config.sessions.downgrade(session, "consecutive-failures");
      return refuse("BUDGET_EXCEEDED", "I am not able to check that right now. I would rather say so than guess.", false);
    }

    // -- loop detection ----------------------------------------------------
    const signature = `${call.name}:${JSON.stringify(call.arguments ?? null)}`;
    const seen = this.recent.get(session.id);
    const repeats = seen?.signature === signature ? seen.count + 1 : 1;
    this.recent.set(session.id, { signature, count: repeats });
    if (repeats > LIMITS.maxRepeatsOfSameCall) {
      return refuse("BUDGET_EXCEEDED", "I have already checked that. Tell me what else you need and I will look that up instead.", false);
    }

    // -- the tool exists, and exists for this caller -----------------------
    if (!isVoiceTool(call.name)) {
      return refuse("UNKNOWN_TOOL", "I cannot do that. I can look up a government service, or walk you through the one you are on.");
    }
    const name: VoiceToolName = call.name;
    const rule = TOOL_POLICY[name];

    // Deny by default, twice over: the session's own list, then the level. The
    // list is the level's projection at creation time, so a session downgraded
    // mid-call narrows immediately without the policy table being consulted.
    if (!session.allowedTools.includes(name)) {
      return refuse("TOOL_NOT_ALLOWED", rule.refusal);
    }
    if (!atLeast(session.identityLevel, rule.minIdentity)) {
      return refuse("IDENTITY_REQUIRED", rule.refusal);
    }

    // -- arguments ---------------------------------------------------------
    const raw = call.arguments;
    if (typeof raw === "string" && Buffer.byteLength(raw) > LIMITS.maxArgumentBytes) {
      return refuse("PAYLOAD_TOO_LARGE", "That was more than I can take in at once. Say the short version and I will look it up.");
    }

    let parsedInput: unknown;
    try {
      parsedInput = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : {}) : (raw ?? {});
    } catch {
      return refuse("INVALID_ARGUMENTS", "I did not catch that. Could you say it again?");
    }

    const parsed = TOOL_ARGUMENTS[name].safeParse(parsedInput);
    if (!parsed.success) {
      // The reason goes to telemetry, never to the caller: a validation error
      // read aloud is a schema the caller can map by probing it.
      emit("voice.guardrail", session.id, { tool: name, reason: "schema", issue: parsed.error.issues[0]?.code }, session.callerHash);
      return refuse("INVALID_ARGUMENTS", "I did not catch that. Could you say it again?");
    }

    // -- run it ------------------------------------------------------------
    try {
      const handled = await withTimeout(
        this.dispatch(session, name, parsed.data as never),
        LIMITS.toolTimeoutMs,
      );
      if ("refusal" in handled) return refuse(handled.refusal.code, handled.refusal.speak, false);

      const leak = leaked(handled.data, session);
      if (leak) {
        // Belt and braces. Nothing below builds a payload containing these, so
        // reaching this line means somebody added a handler that does, and the
        // caller hears a safe sentence rather than an internal id.
        emit("voice.guardrail", session.id, { tool: name, reason: "projection-leak", field: leak }, session.callerHash);
        return refuse("GUARDRAIL", "Let me stick to what I can actually check for you.");
      }

      session.budget.consecutiveFailures = 0;
      await this.config.sessions.save(session);
      emit("voice.tool.success", session.id, { tool: name }, session.callerHash);
      return { ok: true, data: handled.data, grounding: handled.grounding };
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      emit("voice.tool.failure", session.id, { tool: name, code: timedOut ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE" }, session.callerHash);
      session.budget.consecutiveFailures += 1;
      await this.config.sessions.save(session);
      /**
       * §16. The graph is unreachable, so we do not know. We do not reach for
       * what the model remembers about Gujarat, and we do not soften it into
       * something that sounds like an answer.
       */
      return {
        ok: false,
        code: timedOut ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        speak: "I cannot check that right now, so I would rather not say. Shall I try once more?",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private async dispatch(
    session: VoiceSession,
    name: VoiceToolName,
    args: Record<string, never>,
  ): Promise<Handled | { refusal: { code: RefusalCode; speak: string } }> {
    switch (name) {
      case "resolve_need":
        return this.resolveNeed(session, args as unknown as { utterance: string });
      case "build_plan":
        return this.buildPlan(session, args as unknown as { utterance: string });
      case "start_journey":
        return this.startJourney(session, args as unknown as { serviceId: string });
      case "answer_question":
        return this.answerQuestion(session, args as unknown as { questionId: string; answer: unknown });
      case "get_current_journey":
        return this.currentJourney(session);
      case "explain_step":
        return this.explainStep(session, args as unknown as { stepId: string });
      case "save_preference":
        return this.savePreference(session, args as unknown as { key: PreferenceKey; value: string });
      case "forget_my_data":
        return this.forget(session);
      case "resume_journey":
        return this.resume(session);
    }
  }

  /**
   * The guardrail every free-text tool runs first.
   *
   * `resolve_need` and `build_plan` are the only two tools that take a sentence,
   * so they are the only two the input guardrail has anything to do. It is not
   * access control: whatever they return, they return service ids that already
   * exist in the graph. It is here so that a sentence whose only purpose is to
   * attack the system does not also get spent as an intent query.
   */
  private guardText(session: VoiceSession, tool: VoiceToolName, text: string) {
    const check = checkInput(text);
    if (check.verdict === "REFUSE") {
      emit("voice.guardrail", session.id, { tool, reasons: check.reasons }, session.callerHash);
      return { refusal: { code: "GUARDRAIL" as const, speak: check.speak ?? "Tell me what you need to get done." } };
    }
    if (check.verdict === "FLAG") {
      emit("voice.guardrail", session.id, { tool, reasons: check.reasons, action: "flagged" }, session.callerHash);
    }
    return undefined;
  }

  private async resolveNeed(session: VoiceSession, { utterance }: { utterance: string }) {
    const refused = this.guardText(session, "resolve_need", utterance);
    if (refused) return refused;

    const graph = await this.config.graph();
    const { matches } = await this.config.resolveNeed(graph, utterance);
    const projected = projectMatches(matches);
    return {
      data: {
        status: projected.candidates.length ? "CANDIDATES" : "NOT_FOUND",
        candidates: projected.candidates,
        /**
         * The empty state, said rather than filled. The search page refuses to
         * invent a nearest service and so does this; the model is told what to
         * say so it does not improvise something warmer and wronger.
         */
        ...(projected.candidates.length
          ? {}
          : { say: "We have not mapped that one yet. Ask them to say it another way." }),
      },
      grounding: projected.speakableFacts,
    };
  }

  /**
   * A life event, compiled. "I want to start a company" is five services.
   *
   * The division of labour is the same one the whole product runs on: a model
   * picks *which* services out of a list of ids that already exist, and
   * `compilePlan` — deterministic, in `@ariane/core` — decides the order, the
   * documents and the offices. Nothing here invents a service, and a goal that
   * will not compile comes back named in `unknownGoals` rather than dropped.
   *
   * Read only. Answering a question still means opening one of these services
   * with `start_journey`, which keeps a single place where answers are written.
   */
  private async buildPlan(session: VoiceSession, { utterance }: { utterance: string }) {
    const refused = this.guardText(session, "build_plan", utterance);
    if (refused) return refused;

    const planNeed = this.config.planNeed;
    if (!planNeed) {
      return { refusal: { code: "UPSTREAM_UNAVAILABLE" as const, speak: TOOL_POLICY.build_plan.refusal } };
    }

    const graph = await this.config.graph();
    const { goals, title } = await planNeed(graph, utterance);
    if (!goals.length) {
      return {
        refusal: {
          code: "NOT_FOUND" as const,
          speak: "I could not work out which services that involves. Tell me the first thing you need to get done.",
        },
      };
    }

    const compiled = compilePlan(graph, { goals, jurisdiction: session.jurisdiction, intent: utterance });
    if (!compiled.tracks.length) {
      return { refusal: { code: "NOT_FOUND" as const, speak: "I do not have those mapped yet. Tell me one thing you need and I will look that up." } };
    }

    session.activePlan = { intent: utterance, goals: compiled.tracks.map((t) => t.goal), updatedAt: this.now() };
    const projected = projectPlan(compiled, title ?? utterance);
    return { data: projected as unknown as Record<string, unknown>, grounding: projected.speakableFacts, touched: true };
  }

  private async startJourney(session: VoiceSession, { serviceId }: { serviceId: string }) {
    const graph = await this.config.graph();
    const node = graph.nodes.find((n) => n.id === serviceId && n.type === "SERVICE");
    if (!node) {
      // Not found rather than an error, and the same answer whether the id is
      // malformed, belongs to a document, or was invented by the model.
      return { refusal: { code: "NOT_FOUND" as const, speak: "I do not have that service mapped. Tell me what you need in your own words." } };
    }

    session.activeJourney = {
      id: `${session.id}:${serviceId}`,
      serviceId,
      answers: {},
      documents: [],
      updatedAt: this.now(),
    };
    emit("voice.journey.start", session.id, { serviceId }, session.callerHash);
    return this.compileAndProject(session, graph);
  }

  private async answerQuestion(session: VoiceSession, { questionId, answer }: { questionId: string; answer: unknown }) {
    const journey = session.activeJourney;
    if (!journey) return noJourney();

    const graph = await this.config.graph();
    const before = this.compile(session, graph);
    if (before instanceof Error) return compileFailed();

    /**
     * The answer has to be to a question the graph just asked.
     *
     * Without this, `answer_question` is `setFact(anything, anything)`: a
     * caller talks the model into writing a field no condition reads, or worse
     * one that some other journey does read, and the compiler quietly takes it.
     * So the id must be either a field in this compile's outstanding questions,
     * or a document this compile says they still need. Everything else is a
     * question nobody asked.
     */
    const asked = new Set(before.outstandingQuestions.map((q) => q.field));
    const documents = new Set(before.documentsNeeded.map((d) => d.nodeId));

    if (asked.has(questionId)) {
      journey.answers = { ...journey.answers, [questionId]: answer };
    } else if (documents.has(questionId) || journey.documents.includes(questionId)) {
      // A document question is a yes or a no about holding it. Anything else
      // is treated as a no, because "I think so" is not a document.
      //
      // Already-held documents stay answerable: once you say yes, the compiler
      // stops asking, and if the only way in is a question the compiler is
      // still asking then "actually I cannot find it" has nowhere to go. That
      // is a correction a caller makes out loud all the time, and it is still
      // not an arbitrary field write — the id had to earn its way onto this
      // journey's list first.
      const holds = answer === true || answer === "yes" || answer === "true";
      journey.documents = holds
        ? [...new Set([...journey.documents, questionId])]
        : journey.documents.filter((d) => d !== questionId);
    } else {
      return {
        refusal: {
          code: "INVALID_ARGUMENTS" as const,
          speak: "I do not have that question open. Let me ask you the next one.",
        },
      };
    }

    journey.updatedAt = this.now();
    // Persisted only for a caller who is both identified and consenting. An
    // anonymous caller's answers live on the session and die with the call.
    if (session.citizenId && atLeast(session.identityLevel, "VERIFIED")) {
      await this.config.store.saveJourney(session.citizenId, journey, "IN_PROGRESS");
    }
    return this.compileAndProject(session, graph);
  }

  private async currentJourney(session: VoiceSession) {
    if (!session.activeJourney) return noJourney();
    return this.compileAndProject(session, await this.config.graph());
  }

  private async explainStep(session: VoiceSession, { stepId }: { stepId: string }) {
    if (!session.activeJourney) return noJourney();
    const compiled = this.compile(session, await this.config.graph());
    if (compiled instanceof Error) return compileFailed();

    /**
     * Scoped to the journey in progress, not to the graph.
     *
     * `projectStep` searches `compiled.orderedSteps`, so a node id that exists
     * in the graph but not in this citizen's path is a NOT_FOUND. There is no
     * tool here that reads an arbitrary node, which is the difference between
     * a voice interface and a graph API with a microphone on it.
     */
    const projected = projectStep(compiled, stepId);
    if (!projected) {
      return { refusal: { code: "NOT_FOUND" as const, speak: "That is not one of the steps we are on. Shall I tell you the next one?" } };
    }
    return { data: projected as unknown as Record<string, unknown>, grounding: projected.speakableFacts };
  }

  private async savePreference(session: VoiceSession, { key, value }: { key: PreferenceKey; value: string }) {
    // Guaranteed by the policy table, asserted anyway: RECOGNIZED without a
    // citizen id would write a preference belonging to nobody.
    if (!session.citizenId) {
      return { refusal: { code: "IDENTITY_REQUIRED" as const, speak: TOOL_POLICY.save_preference.refusal } };
    }

    /**
     * A language is the one preference that comes back as an instruction: it is
     * read on the next call as "Start in X". So it is stored as a tag we
     * recognise or not at all, and "French" never becomes a standing order.
     */
    let stored = value;
    if (key === "preferred_language") {
      const tag = languageTag(value);
      if (!tag) {
        return {
          refusal: {
            code: "GUARDRAIL" as const,
            speak: "I only speak English and the Indian languages, so I will stay in English.",
          },
        };
      }
      stored = tag;
    }

    await this.config.store.savePreference(session.citizenId, key, stored);
    if (key === "preferred_language") session.language = stored;

    return {
      data: { status: "SAVED", key, value: stored },
      // A preference is a fact about the caller, not about government. It cites
      // nothing because there is nothing to cite, and the model may repeat it.
      grounding: [{ claimId: `preference:${key}`, text: stored }],
      touched: true,
    };
  }

  private async forget(session: VoiceSession) {
    if (!session.citizenId) {
      return { refusal: { code: "IDENTITY_REQUIRED" as const, speak: TOOL_POLICY.forget_my_data.refusal } };
    }

    const { removed } = await this.config.store.forget(session.citizenId);
    // Whatever is still on the session goes too, and the call continues as a
    // stranger. Erasing the row and leaving the id in memory is not erasure.
    session.activeJourney = undefined;
    await this.config.sessions.downgrade(session, "forget-my-data");

    return {
      data: {
        status: "FORGOTTEN",
        removed,
        say: "Everything saved about them is gone. This call carries on, and nothing from it is being kept.",
      },
      grounding: [],
      touched: true,
    };
  }

  private async resume(session: VoiceSession) {
    // VERIFIED is enforced by the policy table before dispatch. Repeated here
    // because this is the single most damaging tool to get wrong: it is the one
    // that reads a real person's saved history out loud.
    if (!session.citizenId || !atLeast(session.identityLevel, "VERIFIED")) {
      return { refusal: { code: "IDENTITY_REQUIRED" as const, speak: TOOL_POLICY.resume_journey.refusal } };
    }

    const saved = await this.config.store.latestJourney(session.citizenId);
    if (!saved) {
      return { refusal: { code: "NOT_FOUND" as const, speak: "I do not have anything saved for you. What would you like to start?" } };
    }

    session.activeJourney = {
      id: saved.id,
      serviceId: saved.serviceId,
      answers: saved.answers,
      documents: saved.documents,
      updatedAt: this.now(),
    };
    emit("voice.journey.resume", session.id, { serviceId: saved.serviceId }, session.callerHash);
    return this.compileAndProject(session, await this.config.graph());
  }

  /**
   * The journey as it stands, for the screen rather than for the model.
   *
   * §23: the panel next to the transcript renders the same compile the voice
   * side is working from, so the two cannot disagree. It spends no budget and
   * takes no arguments, because it is not a capability - it is the session
   * looking at itself, and there is nothing here a caller could aim.
   */
  async snapshot(session: VoiceSession): Promise<Record<string, unknown> | undefined> {
    if (!session.activeJourney) return undefined;
    const compiled = this.compile(session, await this.config.graph());
    if (compiled instanceof Error) return undefined;
    return projectJourney(compiled) as unknown as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Compile
  // -------------------------------------------------------------------------

  /**
   * The one place voice touches Ariane's compiler, and it touches it exactly
   * the way the web app does: `compileJourney(graph, request)`. No second
   * traversal, no voice-specific rules, no shortcut around the condition
   * evaluator. If the screen and the phone ever disagree about a journey, it is
   * because they were given different answers, never because they ran
   * different code.
   */
  private compile(session: VoiceSession, graph: GraphData): CompiledJourney | Error {
    const journey = session.activeJourney;
    if (!journey) return new Error("no active journey");

    const citizen: CitizenContext = {
      documents: journey.documents,
      answers: journey.answers,
    };
    try {
      return compileJourney(graph, {
        goal: journey.serviceId,
        jurisdiction: session.jurisdiction,
        citizen,
      });
    } catch (error) {
      if (error instanceof GoalNotFoundError || error instanceof JurisdictionNotFoundError) return error;
      throw error;
    }
  }

  private compileAndProject(session: VoiceSession, graph: GraphData): Handled | { refusal: { code: RefusalCode; speak: string } } {
    const compiled = this.compile(session, graph);
    if (compiled instanceof Error) return compileFailed();
    const projected = projectJourney(compiled);
    return { data: projected as unknown as Record<string, unknown>, grounding: projected.speakableFacts, touched: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noJourney = () => ({
  refusal: { code: "NO_ACTIVE_JOURNEY" as const, speak: "We have not opened anything yet. Tell me what you need and I will find it." },
});

const compileFailed = () => ({
  refusal: { code: "UPSTREAM_UNAVAILABLE" as const, speak: "I could not put that path together just now. Shall I try again?" },
});

class TimeoutError extends Error {}

/**
 * A fuse, not a scheduler.
 *
 * `compileJourney` is in-process and takes milliseconds, so this only ever
 * fires when something upstream of it hangs: Supabase mid-outage, or the intent
 * chain waiting on a model. A voice call cannot sit in silence while that
 * resolves, so it gets an answer that admits we do not have one.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Nothing internal leaves in a tool result. §15's output guardrail, on the
 * structured side rather than the spoken one.
 *
 * Checks the payload for the three things that would be a real breach if they
 * appeared: the session's bearer token hash, the citizen's primary key, and the
 * caller hash. The model never needs any of them and no handler produces them,
 * so a hit means a bug, and it is cheaper to fail closed than to hope.
 */
function leaked(data: unknown, session: VoiceSession): string | undefined {
  const text = JSON.stringify(data ?? null);
  if (session.tokenHash && text.includes(session.tokenHash)) return "tokenHash";
  if (session.citizenId && text.includes(session.citizenId)) return "citizenId";
  if (session.callerHash && text.includes(session.callerHash)) return "callerHash";
  return undefined;
}
