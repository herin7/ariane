import { z } from "zod";

/**
 * Ariane's own funnel, in eighteen names.
 *
 * An allowlist rather than a `track(anything)` helper, because analytics is how
 * personal data ends up somewhere nobody meant to put it. Every event here is a
 * thing a person did, never a thing a person typed. There is no `search_text`
 * and no `answer_value`, and adding one is a decision somebody has to make in
 * this file with this comment in front of them.
 *
 * The pairing to keep in mind: `question_answered` carries `{ questionId }`.
 * The answer is the citizen's — whether they are a widow, whether their house
 * burned down — and it belongs in their journey, not in a traffic dashboard.
 */
export const APP_EVENTS = [
  "page_view",
  "search_submitted",
  "service_opened",
  "journey_started",
  // A life event, not a service: "start a company" is several journeys and we
  // want to know it was asked for. The sentence itself stays out, as ever.
  "plan_started",
  "question_answered",
  "document_marked",
  "source_opened",
  "office_viewed",
  "office_call_clicked",
  "map_opened",
  "directions_clicked",
  "voice_queue_joined",
  "voice_started",
  "voice_finished",
  "voice_limit_hit",
  "login_started",
  "login_completed",
] as const;

export type AppEventName = (typeof APP_EVENTS)[number];

/**
 * Metadata that survives the trip.
 *
 * Scalars only, twelve keys, short strings. A nested object is where a whole
 * form submission gets smuggled in as "context", and 120 characters is enough
 * for an id or an enum and not enough for a sentence somebody wrote.
 *
 * Keys that name something sensitive are dropped rather than rejected: a client
 * sending `{ answer }` should lose the answer, not lose the event, because a
 * rejected beacon is a bug somebody fixes by turning off the check.
 */
const FORBIDDEN_KEY = /answer|text|query|email|phone|name|address|token|secret|key|ip\b/i;

export const AppEventBody = z.object({
  event: z.enum(APP_EVENTS),
  path: z.string().max(200).optional(),
  serviceId: z.string().max(120).optional(),
  journeyId: z.string().max(120).optional(),
  metadata: z
    .record(z.string().max(60), z.union([z.string().max(120), z.number(), z.boolean()]))
    .optional()
    .transform((meta) =>
      meta
        ? Object.fromEntries(Object.entries(meta).filter(([key]) => !FORBIDDEN_KEY.test(key)).slice(0, 12))
        : undefined,
    ),
});

export type AppEventBody = z.infer<typeof AppEventBody>;

/**
 * The other direction: a sentence somebody meant to send us.
 *
 * Everything above exists to keep typed text *out* of the traffic tables. This
 * is the one route where typed text is the entire point, so it gets the
 * opposite treatment: it goes in its own table, capped and trimmed, and nothing
 * reads it but an operator. Two thousand characters is a long paragraph and not
 * a paste of somebody's Aadhaar file.
 *
 * `contact` is optional on purpose. Asking a citizen for an email before they
 * are allowed to say "the ration card page is wrong" is how you stop hearing
 * that the ration card page is wrong.
 */
export const FeedbackBody = z.object({
  kind: z.enum(["REVIEW", "REQUEST"]),
  message: z.string().trim().min(4).max(2000),
  rating: z.number().int().min(1).max(5).optional(),
  contact: z.string().trim().max(200).optional(),
  path: z.string().max(200).optional(),
});

export type FeedbackBody = z.infer<typeof FeedbackBody>;
