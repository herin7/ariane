import { RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { authClient, caller } from "../../caller";
import { ops } from "../../ops";

/**
 * POST /api/auth/verify — exchange the emailed code for a session.
 *
 * Supabase does the checking. What this route adds is a limit on guessing: six
 * digits is a million combinations, which is a lot for a person and an
 * afternoon for a script, so the same window that governs sending governs
 * trying. §6.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const client = await authClient();
  if (!client) return NextResponse.json({ error: "Sign in is not configured on this deployment" }, { status: 503 });

  let email: string;
  let code: string;
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown };
    email = String(body.email ?? "").trim().toLowerCase();
    code = String(body.code ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the six digit code from your email" }, { status: 400 });
  }

  const store = ops();
  const who = await caller(request);
  const subject = who.ipHash ? `ip:${who.ipHash}` : `email:${email}`;
  const verdict = await store.rateLimit(
    `auth:verify:${subject}`,
    RATE_LIMITS.adminLogin.windowSeconds,
    RATE_LIMITS.adminLogin.max,
  );
  if (!verdict.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  // The session cookies are written by the helper in `caller.ts` as a side
  // effect of this call succeeding. Nothing is handed back to the browser as
  // JavaScript state, so there is no access token for a script on the page to
  // read. §8.
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) {
    return NextResponse.json({ error: "That code was not right, or it has expired" }, { status: 401 });
  }

  await store.touchProfile({ authUserId: data.user.id, email: data.user.email ?? undefined, login: true });
  await store.recordAppEvent({
    eventName: "login_completed",
    authUserId: data.user.id,
    anonymousSessionId: who.anonId,
    ipHash: who.ipHash,
  });

  // The email goes back because the browser just typed it; the user id does
  // not, because nothing on the page has any use for it.
  return NextResponse.json({ signedIn: true, email: data.user.email ?? email });
}
