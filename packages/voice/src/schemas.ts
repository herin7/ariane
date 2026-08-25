import { z } from "zod";
import { VOICE_TOOLS, type VoiceToolName } from "./types";

/**
 * Every boundary, in Zod.
 *
 * Three kinds of thing cross into this package and none of them are trusted:
 * what the model proposed, what the transport sent, and what the caller said.
 * All three arrive here first.
 *
 * `.strict()` everywhere on purpose. A model that adds `citizenId` to a tool
 * call should get a parse error, not a silently ignored field, because the
 * ignored version is indistinguishable from the version where somebody later
 * reads that field.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * A graph node id. Deliberately narrow: these are keys like
 * `service:driving_licence`, and the character class is the entire defence
 * against anything id-shaped being smuggled somewhere it gets interpreted.
 */
const NodeId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_]*:[a-z0-9_.:-]+$/i, "not a graph node id");

/** A question field, as `deriveQuestions` emits it. Same shape rules, no colon required. */
const FieldId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9_.:-]+$/i, "not a question field");

/**
 * What a citizen can answer with.
 *
 * Bounded on every branch. An unbounded answer is a place to park a paragraph
 * of prompt injection and have it stored, which §12 forbids and §26 tests.
 */
const AnswerValue = z.union([
  z.string().min(1).max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().min(1).max(80)).max(20),
]);

// ---------------------------------------------------------------------------
// Tool arguments
// ---------------------------------------------------------------------------

/**
 * The whole capability surface, argument by argument.
 *
 * Read §7 next to this: what matters is not what is here but what is not. There
 * is no url, no query, no id belonging to another person, no free text that
 * gets stored, and no tool whose name contains the words execute, fetch, run,
 * query or user.
 */
export const TOOL_ARGUMENTS = {
  /** Plain language to candidate services. Wraps the existing `resolveIntent`. */
  resolve_need: z.object({ utterance: z.string().min(1).max(400) }).strict(),

  /** Begin a journey. The id must already exist in the graph; the broker checks. */
  start_journey: z.object({ serviceId: NodeId }).strict(),

  /**
   * Answer one of the questions Ariane asked. `questionId` must be a question
   * the *current* compile actually emitted, so the model cannot set a field the
   * graph never asked about.
   */
  answer_question: z.object({ questionId: FieldId, answer: AnswerValue }).strict(),

  /** No arguments, on purpose. §9: identity is resolved from the session. */
  get_current_journey: z.object({}).strict(),

  /** One step of the journey in progress. Not a lookup into the whole graph. */
  explain_step: z.object({ stepId: NodeId }).strict(),

  /**
   * The only write the model has, and it is an enum with a short value.
   * `remember(text)` is what this exists instead of.
   */
  save_preference: z
    .object({
      key: z.enum(["preferred_language", "response_style", "district"]),
      value: z.string().min(1).max(60),
    })
    .strict(),

  /** Erase everything we hold about this caller. No arguments, no target. */
  forget_my_data: z.object({}).strict(),

  /** Pick up a saved journey. VERIFIED only, and the server picks which one. */
  resume_journey: z.object({}).strict(),
} as const satisfies Record<VoiceToolName, z.ZodType>;

/** True when `name` is a tool at all. Everything else is UNKNOWN_TOOL. */
export function isVoiceTool(name: string): name is VoiceToolName {
  return (VOICE_TOOLS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Transport boundaries
// ---------------------------------------------------------------------------

/** POST /api/voice/session. Nothing here can raise an identity level. */
export const SessionRequest = z
  .object({
    /** Where the caller says they live. Ordinary product input, not a credential. */
    jurisdiction: z
      .object({
        country: z.string().min(2).max(8).default("IN"),
        state: z.string().max(16).optional(),
        district: z.string().max(80).optional(),
        taluka: z.string().max(80).optional(),
      })
      .strict()
      .optional(),
    language: z.enum(["en", "hi", "gu"]).optional(),
  })
  .strict();

/**
 * POST /api/voice/tool, from the browser relay.
 *
 * The browser is untrusted the same as the model is. It holds a token bound to
 * one session, and the session decides everything: the token cannot name a
 * citizen, raise a level or widen a tool list.
 */
export const ToolRequest = z
  .object({
    sessionId: z.string().min(8).max(64),
    callId: z.string().min(1).max(120),
    name: z.string().min(1).max(64),
    /** Providers send a JSON string. Objects are accepted for direct callers. */
    arguments: z.union([z.string().max(4096), z.record(z.string(), z.unknown())]).optional(),
  })
  .strict();

/**
 * The slice of a Vapi webhook we read.
 *
 * Passthrough rather than strict: this is somebody else's payload and it will
 * grow fields. What matters is that only the named fields are ever read, and
 * that the signature was checked before this schema ran.
 */
export const VapiWebhook = z.object({
  message: z.object({
    type: z.string().min(1).max(64),
    call: z
      .object({
        id: z.string().min(1).max(120),
        customer: z.object({ number: z.string().max(32).optional() }).loose().optional(),
      })
      .loose()
      .optional(),
    toolCalls: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          function: z.object({
            name: z.string().min(1).max(64),
            arguments: z.union([z.string().max(4096), z.record(z.string(), z.unknown())]).optional(),
          }),
        }),
      )
      .max(8)
      .optional(),
  }),
});

/**
 * A phone number as a provider hands it over.
 *
 * Not authentication. §10. This is checked for shape so that a caller id header
 * cannot be a paragraph, and normalised in `identity.ts` before it is hashed.
 */
export const RawPhone = z.string().min(6).max(24).regex(/^\+?[0-9 ()\-.]+$/, "not a phone number");
