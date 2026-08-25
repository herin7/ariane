import { ToolRequest } from "@ariane/voice";
import { NextResponse } from "next/server";
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

  const result = await voice.broker.execute(session, {
    callId: parsed.data.callId,
    name: parsed.data.name,
    arguments: parsed.data.arguments,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_FOR[result.code] });
}
