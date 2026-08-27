import { CAPACITY, SessionRequest, TIERS, emit, realtimeSessionConfig } from "@ariane/voice";
import { mintClientSecret, realtimeConfigured, type AdmitResult } from "@ariane/voice/server";
import { NextResponse } from "next/server";
import { caller } from "../../caller";
import { STATUS_FOR, bearer, notConfigured, runtime } from "../shared";

/**
 * POST /api/voice/session — open a browser voice call.
 * PATCH /api/voice/session — still here, keep my line.
 * DELETE /api/voice/session?sessionId=… — hang up.
 *
 * The only place an Azure AI Foundry credential is created, and what leaves
 * here is an ephemeral one scoped to a single realtime session. §5: a permanent
 * key in a browser is a permanent key in devtools.
 *
 * Note what the request body cannot contain. There is no citizen id, no
 * identity level, no tool list, no duration, no tier and no instruction
 * override. The tool list the model gets is computed here from the session's
 * level and baked into the credential, and the call's length is looked up from
 * `TIERS` by a word this file decided. A browser that edits its copy is a
 * browser proposing tools the broker has never heard of. §9, §3.
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

  const who = await caller(request);
  // A ticket is the only thing about capacity a browser may present, and it is
  // useless without the claim token the server minted for it.
  const claim = body as { ticket?: unknown; claimToken?: unknown };
  const ticket = typeof claim.ticket === "string" ? claim.ticket : undefined;
  const claimToken = typeof claim.claimToken === "string" ? claim.claimToken : undefined;

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
      // Signing in raises the tier and the call length; it does not by itself
      // raise the identity level, which still needs a step-up challenge.
      tier: who.tier,
      authUserId: who.authUserId,
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

  /**
   * The gate, and everything expensive is behind it. §4, §5.
   *
   * The session row above costs nothing and holds no line; this is what takes
   * one, and no realtime credential is minted, no WebRTC offer is made and no
   * audio token is spent until it says yes. Every refusal below ends the
   * session rather than leaving a row behind.
   */
  const admitted = await voice.capacity.admit({
    sessionId: session.id,
    tier: session.tier,
    authUserId: who.authUserId,
    ipHash: who.ipHash,
    guestId: who.guestId,
    ticket,
    claimToken,
  });
  if (!admitted.ok) {
    await voice.sessions.end(session);
    // §10, and the number that says whether ten lines is enough: a call that
    // was wanted and not served. The reason, never who wanted it.
    await voice.ops.recordAppEvent({
      eventName: "voice_limit_hit",
      authUserId: who.authUserId,
      anonymousSessionId: who.anonId,
      ipHash: who.ipHash,
      metadata: { reason: admitted.reason, tier: session.tier },
    });
    return refuse(admitted);
  }

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
    // The session is already created and holding a line. End it and hand the
    // line straight back rather than making the next caller wait out a lease
    // for a call that never connected.
    await voice.capacity.release(session.id);
    await voice.sessions.end(session);
    console.error("Could not mint a realtime credential", error);
    return NextResponse.json({ error: "Voice is unavailable right now" }, { status: 502 });
  }

  emit("voice.session.start", session.id, { provider: "BROWSER", identityLevel: session.identityLevel });

  // Text only, and only what the caller said and Ariane answered. §9.
  const conversationId = await voice.ops.startConversation({
    sessionId: session.id,
    authUserId: who.authUserId,
    citizenId: session.citizenId,
    ipHash: who.ipHash,
    tier: session.tier,
    identityLevel: session.identityLevel,
    provider: "BROWSER",
    language: session.language,
    queueWaitMs: admitted.waitedMs,
  });
  await voice.ops.recordAppEvent({
    eventName: "voice_started",
    authUserId: who.authUserId,
    anonymousSessionId: who.anonId,
    ipHash: who.ipHash,
    metadata: { tier: session.tier, conversationId: conversationId ? "yes" : "no" },
  });

  return NextResponse.json({
    sessionId: created.issued.sessionId,
    token: created.issued.token,
    clientSecret: credential.value,
    model: credential.model,
    callUrl: credential.callUrl,
    // Two clocks, deliberately. The credential expires in about a minute and
    // covers the handshake; the session is the whole call.
    credentialExpiresAt: credential.expiresAt,
    expiresAt: created.issued.expiresAt,
    tier: created.issued.tier,
    /**
     * Sent so the panel can draw a countdown, and worth nothing else. The stop
     * is `expiresAt` on the server row, the lease TTL in Postgres and
     * `maxDurationSeconds` on the provider; a browser that doubles this number
     * gets a timer that lies to its own user for the last minute of a call that
     * ends anyway. §3.
     */
    maxCallMs: TIERS[session.tier].maxCallMs,
    heartbeatMs: CAPACITY.heartbeatMs,
    identityLevel: created.issued.identityLevel,
    allowedTools: created.issued.allowedTools,
    returning: created.returning,
  });
}

/**
 * PATCH — the heartbeat. §4.
 *
 * A held line that stops reporting is a line the pool takes back, so this is
 * what tells the difference between a call in progress and a laptop that went
 * into a bag. It also carries the clock home: the browser learns how long it
 * has left from the server every fifteen seconds rather than from its own
 * `setTimeout`, which a background tab throttles and devtools can rewrite.
 */
export async function PATCH(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const token = bearer(request);
  if (!sessionId || !token) return NextResponse.json({ error: "sessionId and a bearer token are required" }, { status: 400 });

  const session = await voice.sessions.authenticate(sessionId, token);
  if (typeof session === "string") {
    // Expired, ended or never existed. Whichever it is, the line is not theirs
    // any more, so hand it back on the way out.
    await voice.capacity.release(sessionId);
    return NextResponse.json({ live: false, remainingMs: 0, reason: session }, { status: 200 });
  }

  const remainingMs = Math.max(0, session.expiresAt - Date.now());
  if (remainingMs <= 0) {
    await voice.sessions.end(session);
    await voice.capacity.release(session.id);
    return NextResponse.json({ live: false, remainingMs: 0, reason: "SESSION_EXPIRED" });
  }

  const held = await voice.capacity.heartbeat(session.id);
  return NextResponse.json({ live: held, remainingMs, expiresAt: session.expiresAt });
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
    // The line still goes back: a bad token is not a reason to hold it.
    await voice.capacity.release(sessionId);
    return NextResponse.json({ ended: true });
  }

  await voice.sessions.end(session);
  await voice.capacity.release(session.id);

  const durationMs = Math.max(0, Date.now() - session.startedAt);
  const conversationId = await voice.ops.conversationForSession(session.id);
  if (conversationId) {
    await voice.ops.endConversation(conversationId, { endReason: "HANGUP", durationMs });
  }

  await voice.ops.recordAppEvent({
    eventName: "voice_finished",
    authUserId: session.authUserId,
    metadata: { tier: session.tier, seconds: Math.round(durationMs / 1000) },
  });

  emit("voice.session.end", session.id, { provider: session.provider });
  return NextResponse.json({ ended: true });
}

/**
 * A refusal a person can act on. §23: being tenth in a queue is not an error,
 * and a page that says "500" to somebody waiting their turn has told them to
 * go away.
 */
function refuse(result: Extract<AdmitResult, { ok: false }>) {
  switch (result.reason) {
    case "BUSY":
      return NextResponse.json(
        {
          error: `All ${CAPACITY.maxConcurrentCalls} Ariane lines are currently helping someone.`,
          code: "BUSY",
          queueDepth: result.queueDepth,
          active: result.active,
        },
        { status: 503 },
      );
    case "GUEST_QUOTA":
      return NextResponse.json(
        {
          error: "Your one-minute preview is up. Sign in to keep talking.",
          code: "GUEST_QUOTA",
          resetAt: result.resetAt,
        },
        { status: 402 },
      );
    case "RATE_LIMITED":
      return NextResponse.json(
        { error: "That was a lot of calls at once. Give it a minute.", code: "RATE_LIMITED", retryAt: result.retryAt },
        { status: 429 },
      );
    case "COOLDOWN":
      // Deliberately vague, and deliberately about voice only: this person can
      // still read every service and every journey on the site.
      return NextResponse.json(
        { error: "Voice is paused for this connection. Please try again later.", code: "COOLDOWN", until: result.until },
        { status: 429 },
      );
    case "CLAIM_INVALID":
      return NextResponse.json(
        { error: "Your place in line expired. Please try again.", code: "CLAIM_INVALID" },
        { status: 409 },
      );
  }
}
