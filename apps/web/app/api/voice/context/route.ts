import { NextResponse } from "next/server";
import { STATUS_FOR, bearer, notConfigured, runtime } from "../shared";

/**
 * GET /api/voice/context?sessionId=… — what the screen should show.
 *
 * §23: the visual journey and the spoken one are the same journey. This returns
 * the same projection the model was handed, compiled from the same session
 * state, so a panel rendered beside the transcript cannot drift from what the
 * caller is being told.
 *
 * Read only, no budget, no arguments beyond the session it authenticates. It is
 * the session looking at itself rather than a capability, which is why it is not
 * a tool.
 */
export async function GET(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const token = bearer(request);
  if (!sessionId || !token) {
    return NextResponse.json({ error: "sessionId and a bearer token are required" }, { status: 400 });
  }

  const session = await voice.sessions.authenticate(sessionId, token);
  if (typeof session === "string") {
    return NextResponse.json({ error: session }, { status: STATUS_FOR[session] });
  }

  return NextResponse.json({
    sessionId: session.id,
    identityLevel: session.identityLevel,
    allowedTools: session.allowedTools,
    jurisdiction: session.jurisdiction,
    language: session.language ?? null,
    expiresAt: session.expiresAt,
    // Null rather than absent: the panel renders an empty state for "we have
    // not opened anything yet", and a missing key reads as a bug.
    journey: (await voice.broker.snapshot(session)) ?? null,
  });
}
