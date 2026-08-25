import { emit } from "@ariane/voice";
import { parseVapiEvent, vapiToolResponse, verifyVapiSignature } from "@ariane/voice/server";
import { NextResponse } from "next/server";
import { notConfigured, runtime } from "../../shared";

/**
 * POST /api/voice/vapi/webhook — the telephony leg. §18.
 *
 * Nothing here is public. The raw body is read first and verified before a
 * single field is looked at, because a payload that has not been authenticated
 * is not data yet. An unsigned request gets 401 and no explanation.
 *
 * The session is found by the provider's call id, never by anything in the
 * body claiming to be one. That is the same rule as §9 one level down: the
 * transport says which call this is, and the call says who the citizen is.
 */
export async function POST(request: Request) {
  const voice = runtime();
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!voice || !secret) return notConfigured();

  // Raw text, not `request.json()`: the signature covers the exact bytes and
  // re-serialising a parsed object changes them.
  const raw = await request.text();
  const verified = verifyVapiSignature({ body: raw, headers: request.headers, secret });
  if (!verified.ok) {
    emit("voice.guardrail", "unauthenticated", { transport: "vapi", reason: verified.reason });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const event = parseVapiEvent(payload);
  if (!event?.providerCallId) return NextResponse.json({});

  const callId = event.providerCallId;

  if (event.ended) {
    const existing = await voice.sessions.byProviderCall(callId);
    if (existing) {
      await voice.sessions.end(existing);
      emit("voice.session.end", existing.id, { provider: "VAPI" }, existing.callerHash);
    }
    return NextResponse.json({});
  }

  /**
   * One session per call, created on whichever event arrives first.
   *
   * The caller's number goes in and a keyed hash comes out; the number itself
   * is never stored and never logged. §10 and §11 - it buys RECOGNIZED for a
   * returning caller and not one level more.
   */
  let session = await voice.sessions.byProviderCall(callId);
  if (!session) {
    const created = await voice.sessions.create({
      provider: "VAPI",
      providerCallId: callId,
      rawPhone: event.callerNumber,
    });
    if (!created.ok) {
      // A ceiling, spoken. Vapi reads `results[].result` out to the caller, so
      // a refusal still leaves them with a sentence rather than dead air.
      return NextResponse.json(
        vapiToolResponse(event.toolCalls.map((call) => ({ callId: call.callId, result: created.speak }))),
      );
    }
    session = created.session;
    emit("voice.session.start", session.id, { provider: "VAPI", identityLevel: session.identityLevel }, session.callerHash);
  }

  if (!event.toolCalls.length) return NextResponse.json({});

  // Re-authenticate against the call id even though we just looked the session
  // up by it: `authenticateCall` is also where expiry and status are checked.
  const authenticated = await voice.sessions.authenticateCall(session.id, callId);
  if (typeof authenticated === "string") {
    return NextResponse.json(
      vapiToolResponse(
        event.toolCalls.map((call) => ({ callId: call.callId, result: "This call has gone on a while. Let me start fresh." })),
      ),
    );
  }

  const results = [];
  for (const call of event.toolCalls) {
    // Sequentially, not in parallel: they share one session and one budget, and
    // two handlers mutating the same journey concurrently is a race for no gain
    // when a caller can only be asked one question at a time anyway.
    const result = await voice.broker.execute(authenticated, call);
    results.push({ callId: call.callId, result: JSON.stringify(result) });
  }

  return NextResponse.json(vapiToolResponse(results));
}
