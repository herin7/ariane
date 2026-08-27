import { RATE_LIMITS, ToolRequest } from "@ariane/voice";
import { NextResponse } from "next/server";
import { caller } from "../../caller";
import { STATUS_FOR, bearer, notConfigured, runtime } from "../shared";

/**
 * POST /api/voice/tool — the model proposed something. We decide.
 *
 * §18: not a generic public POST API. It takes a bearer token bound to one
 * session, and the session is the only thing that says who the caller is and
 * what they may reach. The body names a tool and some arguments; it cannot name
 * a citizen, a table, a level or a limit, because nothing here reads one.
 *
 * Everything past authentication is `VoiceBroker.execute`, which never throws
 * and always returns something safe to say out loud.
 */

/**
 * `resolve_need` runs the same three pass intent chain the search box does, so
 * this route inherits its worst case. A caller is on the phone waiting while it
 * happens, which makes a timeout here more expensive than a slow answer.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const token = bearer(request);
  if (!token) {
    return NextResponse.json({ ok: false, code: "NO_SESSION", speak: "Let me start again." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_ARGUMENTS", speak: "I did not catch that." }, { status: 400 });
  }

  const parsed = ToolRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_ARGUMENTS", speak: "I did not catch that." }, { status: 400 });
  }

  const session = await voice.sessions.authenticate(parsed.data.sessionId, token);
  if (typeof session === "string") {
    return NextResponse.json(
      { ok: false, code: session, speak: "This call has ended. Start a new one and I will pick it up." },
      { status: STATUS_FOR[session] },
    );
  }

  /**
   * §6. A ceiling on tool calls per minute, on top of the broker's own per-call
   * budget: the budget stops one call spending forever, this stops one caller
   * opening call after call and spending the same amount across all of them.
   */
  const who = await caller(request);
  const subject = who.authUserId ? `user:${who.authUserId}` : who.ipHash ? `ip:${who.ipHash}` : `session:${session.id}`;
  const verdict = await voice.ops.rateLimit(
    `voice:tool:${subject}`,
    RATE_LIMITS.voiceTool.windowSeconds,
    RATE_LIMITS.voiceTool.max,
  );
  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", speak: "Let me catch up. Ask me that again in a moment." },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  const result = await voice.broker.execute(session, {
    callId: parsed.data.callId,
    name: parsed.data.name,
    arguments: parsed.data.arguments,
  });

  /**
   * What the model asked for and what it got, for the admin panel. §9, §12.
   *
   * Never the arguments themselves and never the result: `resolve_need` carries
   * the sentence a citizen said and a journey projection is most of their
   * situation. The name, the outcome and how long it took is what an operator
   * actually needs to see, and it is also all this is allowed to keep.
   */
  const conversationId = await voice.ops.conversationForSession(session.id);
  if (conversationId) {
    await voice.ops.recordToolEvent(conversationId, {
      toolName: parsed.data.name,
      status: result.ok ? "OK" : result.code,
      durationMs: Date.now() - startedAt,
    });
  }

  // A denied tool is the signal §7 wants written down: the model proposed
  // something this call's identity level does not reach. It is not by itself an
  // attack — a caller who asks to save a preference before consenting trips it
  // honestly — so it is recorded and counted, and nothing else.
  if (!result.ok && (result.code === "TOOL_NOT_ALLOWED" || result.code === "UNKNOWN_TOOL" || result.code === "GUARDRAIL")) {
    await voice.security
      .record({
        sessionId: session.id,
        authUserId: who.authUserId,
        ipHash: who.ipHash,
        category: result.code === "GUARDRAIL" ? "prompt-injection" : "tool-denied",
        severity: result.code === "UNKNOWN_TOOL" ? "MEDIUM" : "LOW",
        actionTaken: "refused",
        metadata: { tool: parsed.data.name, code: result.code },
      })
      .catch((error) => console.warn("could not record a security event", error instanceof Error ? error.message : error));
  }

  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_FOR[result.code] });
}
