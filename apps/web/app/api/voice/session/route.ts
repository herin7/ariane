import { SessionRequest, emit, realtimeSessionConfig } from "@ariane/voice";
import { mintClientSecret, realtimeConfigured } from "@ariane/voice/server";
import { NextResponse } from "next/server";
import { STATUS_FOR, bearer, notConfigured, runtime } from "../shared";

/**
 * POST /api/voice/session — open a browser voice call.
 * DELETE /api/voice/session?sessionId=… — hang up.
 *
 * The only place an Azure AI Foundry credential is created, and what leaves
 * here is an ephemeral one scoped to a single realtime session. §5: a permanent
 * key in a browser is a permanent key in devtools.
 *
 * Note what the request body cannot contain. There is no citizen id, no
 * identity level, no tool list and no instruction override. The tool list the
 * model gets is computed here from the session's level and baked into the
 * credential, so a browser that edits its copy is a browser proposing tools the
 * broker has never heard of. §9.
 */
export async function POST(request: Request) {
  const voice = runtime();
  if (!voice || !realtimeConfigured()) return notConfigured();

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = SessionRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "jurisdiction or language was not valid" }, { status: 400 });
  }

  /**
   * The store can be unreachable, or its tables can be missing because nobody
   * ran `voice-schema.sql` yet. Both are a deployment problem rather than a
   * caller's, and neither should reach a citizen as a stack trace: what leaves
   * here is the same sentence a mint failure gets, and the detail goes to the
   * server log where the person who can fix it is looking.
   */
  let created;
  try {
    created = await voice.sessions.create({
      provider: "BROWSER",
      // No caller id on this leg, so no RECOGNIZED and no returning-caller path.
      // A browser session is anonymous until somebody builds a web sign-in, and
      // anonymous reaches everything public, which is nearly all of it.
      jurisdiction: parsed.data.jurisdiction,
      language: parsed.data.language,
    });
  } catch (error) {
    console.error("Could not open a voice session", error);
    return NextResponse.json({ error: "Voice is unavailable right now" }, { status: 502 });
  }
  if (!created.ok) {
    return NextResponse.json({ error: created.speak, code: created.code }, { status: STATUS_FOR[created.code] });
  }

  const { session } = created;
  const config = realtimeSessionConfig(
    {
      identityLevel: session.identityLevel,
      returning: created.returning,
      district: session.jurisdiction.district,
      language: session.language,
      needsConsentLine: !created.returning,
    },
    session.allowedTools,
  );

  let credential;
  try {
    credential = await mintClientSecret(config);
  } catch (error) {
    // The session is already created and counted. End it rather than leaving a
    // row that holds a concurrency slot for ten minutes over a failed mint.
    await voice.sessions.end(session);
    console.error("Could not mint a realtime credential", error);
    return NextResponse.json({ error: "Voice is unavailable right now" }, { status: 502 });
  }

  emit("voice.session.start", session.id, { provider: "BROWSER", identityLevel: session.identityLevel });

  return NextResponse.json({
    sessionId: created.issued.sessionId,
    token: created.issued.token,
    clientSecret: credential.value,
    model: credential.model,
    callUrl: credential.callUrl,
    // Two clocks, deliberately. The credential expires in about a minute and
    // covers the handshake; the session is the ten minute call.
    credentialExpiresAt: credential.expiresAt,
    expiresAt: created.issued.expiresAt,
    identityLevel: created.issued.identityLevel,
    allowedTools: created.issued.allowedTools,
    returning: created.returning,
  });
}

export async function DELETE(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const token = bearer(request);
  if (!sessionId || !token) return NextResponse.json({ error: "sessionId and a bearer token are required" }, { status: 400 });

  const session = await voice.sessions.authenticate(sessionId, token);
  if (typeof session === "string") {
    // Already gone is a success. A client that hangs up twice on a flaky
    // connection should not see an error, and there is nothing left to leak.
    return NextResponse.json({ ended: true });
  }

  await voice.sessions.end(session);
  emit("voice.session.end", session.id, { provider: session.provider });
  return NextResponse.json({ ended: true });
}
