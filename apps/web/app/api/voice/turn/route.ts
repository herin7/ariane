import { RATE_LIMITS, checkInput, redactText } from "@ariane/voice";
import type { SecurityCategory } from "@ariane/voice/server";
import { NextResponse } from "next/server";
import { caller } from "../../caller";
import { notConfigured, runtime } from "../shared";

/**
 * POST /api/voice/turn — one line of what was said.
 *
 * Audio goes browser-to-Azure over WebRTC and never touches this server, which
 * is the property that makes §9 easy to keep: there is no recording here to
 * delete because there was never one to make. What the admin panel shows is
 * text, and text only arrives because the browser posts it here.
 *
 * That means the transcript is best effort by construction. A caller who blocks
 * this endpoint gets a call with no transcript, and nothing about the call
 * changes — no limit, no duration, no tool. Losing a line of text must never be
 * able to affect a citizen's call, so nothing downstream of it is load bearing.
 *
 * Redaction happens here, before the insert. §9: an Aadhaar number a person
 * read out loud is not a thing this database is allowed to contain.
 */
export const dynamic = "force-dynamic";

/** Long enough for a paragraph somebody actually said. Past that it is a payload. */
const MAX_TEXT = 4_000;

export async function POST(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  let sessionId: string;
  let role: string;
  let text: string;
  try {
    const body = (await request.json()) as { sessionId?: unknown; role?: unknown; text?: unknown };
    sessionId = String(body.sessionId ?? "");
    role = String(body.role ?? "");
    text = String(body.text ?? "");
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (role !== "USER" && role !== "ASSISTANT") {
    // TOOL turns are written by the broker, which knows what it ran. A browser
    // claiming a tool result would be a browser writing Ariane's own evidence.
    return NextResponse.json({ error: "role must be USER or ASSISTANT" }, { status: 400 });
  }
  if (!sessionId || !text.trim()) return NextResponse.json({ recorded: false });

  const token = request.headers.get("authorization")?.replace(/^Bearer /, "").trim();
  if (!token) return NextResponse.json({ error: "A bearer token is required" }, { status: 401 });

  const session = await voice.sessions.authenticate(sessionId, token);
  if (typeof session === "string") return NextResponse.json({ error: "No session" }, { status: 401 });

  const who = await caller(request);
  const subject = who.authUserId ? `user:${who.authUserId}` : who.ipHash ? `ip:${who.ipHash}` : `session:${sessionId}`;
  const verdict = await voice.ops.rateLimit(
    `voice:turn:${subject}`,
    RATE_LIMITS.voiceTurn.windowSeconds,
    RATE_LIMITS.voiceTurn.max,
  );
  // Dropped rather than refused. A dropped transcript line is a gap in a log;
  // a 429 the client has to handle mid-call is a bug waiting to end a call.
  if (!verdict.allowed) return NextResponse.json({ recorded: false });

  const clipped = text.slice(0, MAX_TEXT);

  /**
   * §7. The same classifier the broker uses on tool arguments, run over what
   * was actually said, because a probe that never reaches a tool still tells an
   * operator that somebody is trying.
   *
   * It records and it counts. It does not refuse, does not end the call and
   * does not ban anybody — three HIGH events in an hour does, and that decision
   * is arithmetic in `security.ts` over rows, not this classifier's opinion.
   */
  if (role === "USER") {
    const check = checkInput(clipped);
    if (check.verdict !== "ALLOW") {
      await voice.security
        .record({
          sessionId: session.id,
          authUserId: who.authUserId,
          ipHash: who.ipHash,
          category: categorise(check.reasons),
          severity: check.verdict === "REFUSE" ? "HIGH" : "LOW",
          actionTaken: "logged",
          input: clipped,
          metadata: { reasons: check.reasons },
        })
        .catch((error) => console.warn("could not record a security event", error instanceof Error ? error.message : error));
    }
  }

  const conversationId = await voice.ops.conversationForSession(session.id);
  if (!conversationId) return NextResponse.json({ recorded: false });

  await voice.ops.appendTurn(conversationId, {
    role,
    // Not `redact`: this is a whole utterance and the default 200-character cap
    // would file most of a sentence under an ellipsis.
    text: redactText(clipped, MAX_TEXT),
  });

  return NextResponse.json({ recorded: true });
}

/**
 * The reason a turn was flagged, as a category an operator can filter on.
 *
 * Ordered most specific first: a sentence that asks for an API key while
 * claiming to be an admin is filed as a secret probe, because that is the one
 * worth reading.
 */
function categorise(reasons: string[]): SecurityCategory {
  if (reasons.includes("secret-request")) return "secret-probe";
  if (reasons.includes("cross-user")) return "cross-user-probe";
  if (reasons.includes("identity-assertion")) return "identity-probe";
  if (reasons.includes("bypass")) return "limit-probe";
  return "prompt-injection";
}
