import type { RefusalCode } from "@ariane/voice";
import { voiceRuntime } from "@ariane/voice/server";
import { NextResponse } from "next/server";

/**
 * The bits all four voice routes need. Not a route itself: only `route.ts`
 * files become endpoints, so this sits beside them without being one.
 */

/**
 * A refusal, as an HTTP status.
 *
 * The body is the same `ToolResult` either way and the browser relay reads it
 * regardless of the status, so this is for the humans and the proxies rather
 * than for the client. Codes stay stable because the red-team tests assert on
 * them.
 */
export const STATUS_FOR: Record<RefusalCode, number> = {
  NO_SESSION: 401,
  SESSION_EXPIRED: 401,
  SESSION_ENDED: 401,
  UNKNOWN_TOOL: 403,
  TOOL_NOT_ALLOWED: 403,
  IDENTITY_REQUIRED: 403,
  GUARDRAIL: 403,
  INVALID_ARGUMENTS: 400,
  PAYLOAD_TOO_LARGE: 413,
  BUDGET_EXCEEDED: 429,
  RATE_LIMITED: 429,
  NO_ACTIVE_JOURNEY: 404,
  NOT_FOUND: 404,
  UPSTREAM_UNAVAILABLE: 502,
  TIMEOUT: 504,
};

/** `Authorization: Bearer <token>`. Never a query string: those end up in logs. */
export function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() || undefined : undefined;
}

export const notConfigured = () =>
  NextResponse.json(
    { error: "Voice is not configured on this deployment" },
    // 503 and not 404: the route exists, the deployment has not been given the
    // keys. A frontend can tell the two apart and hide the button.
    { status: 503 },
  );

/** The shared runtime, or undefined when the secrets are missing. */
export function runtime() {
  const value = voiceRuntime();
  return value.ready ? value : undefined;
}
