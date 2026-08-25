import { createHmac, timingSafeEqual } from "node:crypto";
import { VapiWebhook } from "../schemas";
import type { ToolCall } from "../types";

/**
 * Telephony. §18.
 *
 * Vapi owns the phone line, the SIP leg, the call lifecycle and the audio. It
 * does not own a single decision about government or about who the caller is,
 * and this file is the only place in the repository that knows the word Vapi
 * exists. Everything downstream sees a `ToolCall` and a session, exactly as the
 * browser leg produces, which is the whole point of the abstraction: swapping
 * telephony providers should be one file, not a search across the compiler.
 */

export type VapiEventType = "tool-calls" | "status-update" | "end-of-call-report" | "assistant-request" | "other";

export interface VapiEvent {
  type: VapiEventType;
  providerCallId?: string;
  /** Raw, as the provider gave it. Normalised and hashed in `identity.ts`. */
  callerNumber?: string;
  toolCalls: ToolCall[];
  /** Terminal statuses end the session and flush its budget. */
  ended: boolean;
}

/**
 * How far a signature timestamp may be from now. §18's replay window.
 *
 * Five minutes each way, because a webhook retried across a network blip is
 * ordinary and a replay of a signed payload from last week is not. Symmetric
 * because the two clocks are not ours and one of them is usually a little
 * ahead.
 */
const REPLAY_WINDOW_MS = 5 * 60_000;

export interface VerifyInput {
  body: string;
  headers: Headers | Record<string, string | undefined>;
  secret: string;
  now?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const header = (headers: VerifyInput["headers"], name: string): string | undefined =>
  headers instanceof Headers ? (headers.get(name) ?? undefined) : headers[name] ?? headers[name.toLowerCase()];

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Is this really Vapi, and is it recent.
 *
 * Two accepted forms, because Vapi's own configuration offers both and a
 * deployment should not have to pick the weaker one by accident:
 *
 *   `x-vapi-signature: t=<ms>,v1=<hex>`  HMAC-SHA256 over `<t>.<body>`. Proves
 *       the payload was not altered and, with the timestamp, that it was not
 *       replayed. This is the one to configure.
 *
 *   `x-vapi-secret: <shared secret>`  A bearer header. Proves the sender knows
 *       the secret and nothing about the payload, so a captured request can be
 *       replayed until the secret is rotated. Supported because it is what the
 *       dashboard sets up by default, compared in constant time, and it is why
 *       `authenticateCall` binds every tool call to a session by call id
 *       regardless.
 *
 * Anything else is rejected. There is no unauthenticated path to this endpoint;
 * §18 is explicit that a tool endpoint must not be a public POST API, and a
 * missing header is a rejection rather than a default.
 */
export function verifyVapiSignature(input: VerifyInput): VerifyResult {
  const { body, headers, secret } = input;
  if (!secret) return { ok: false, reason: "no-secret-configured" };

  const signature = header(headers, "x-vapi-signature");
  if (signature) {
    const parts = Object.fromEntries(
      signature.split(",").map((part) => {
        const [key = "", ...rest] = part.trim().split("=");
        return [key, rest.join("=")];
      }),
    );
    const timestamp = Number(parts.t);
    const provided = parts.v1;
    if (!Number.isFinite(timestamp) || !provided) return { ok: false, reason: "malformed-signature" };

    const now = input.now ?? Date.now();
    if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) return { ok: false, reason: "stale-timestamp" };

    const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return safeEqual(provided, expected) ? { ok: true } : { ok: false, reason: "bad-signature" };
  }

  const shared = header(headers, "x-vapi-secret");
  if (shared) return safeEqual(shared, secret) ? { ok: true } : { ok: false, reason: "bad-secret" };

  return { ok: false, reason: "unsigned" };
}

/**
 * A verified payload, in this package's own vocabulary.
 *
 * Call `verifyVapiSignature` first. This function parses and does not
 * authenticate, and keeping those apart means the route reads as two steps
 * rather than one function somebody later assumes did both.
 */
export function parseVapiEvent(payload: unknown): VapiEvent | undefined {
  const parsed = VapiWebhook.safeParse(payload);
  if (!parsed.success) return undefined;

  const { message } = parsed.data;
  const type: VapiEventType = (["tool-calls", "status-update", "end-of-call-report", "assistant-request"] as const).includes(
    message.type as never,
  )
    ? (message.type as VapiEventType)
    : "other";

  return {
    type,
    providerCallId: message.call?.id,
    callerNumber: message.call?.customer?.number,
    toolCalls: (message.toolCalls ?? []).map((call) => ({
      callId: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    ended: type === "end-of-call-report",
  };
}

/** The result shape Vapi expects back for a tool call. */
export function vapiToolResponse(results: { callId: string; result: string }[]): {
  results: { toolCallId: string; result: string }[];
} {
  return { results: results.map((r) => ({ toolCallId: r.callId, result: r.result })) };
}

export const vapiConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.VAPI_WEBHOOK_SECRET);
