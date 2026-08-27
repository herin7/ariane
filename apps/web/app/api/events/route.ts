import { AppEventBody, RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { caller } from "../caller";
import { ops } from "../ops";

/**
 * POST /api/events — one thing a person did.
 *
 * Ariane's own funnel, first party, no third party script and no cookie banner
 * to argue about. §10, §16: the admin dashboard is rendered from these rows,
 * so nothing about traction needs a vendor's API key.
 *
 * The allowlist is in `@ariane/voice`, not here, and it is an allowlist rather
 * than a filter: an event name this deployment has not thought about is
 * refused, and metadata keys that name anything a person typed are dropped
 * before the insert. What a citizen searched for and what they answered are not
 * traffic data.
 *
 * Beacon-shaped: always 202, never a body worth reading, never a reason to
 * retry. Analytics that can fail a page is analytics that will.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const accepted = NextResponse.json({ ok: true }, { status: 202 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return accepted;
  }

  const parsed = AppEventBody.safeParse(body);
  if (!parsed.success) return accepted;

  const who = await caller(request);

  /**
   * A path is a thing the client sends, so it is checked here rather than
   * trusted. §15 in reverse: admin browsing does not go to Vercel Analytics,
   * and it does not go in `app_events` either — an operator reading the
   * dashboard should not appear in the traffic they are reading.
   */
  if (parsed.data.path?.startsWith("/admin")) return accepted;

  const store = ops();
  const subject = who.authUserId ? `user:${who.authUserId}` : who.ipHash ? `ip:${who.ipHash}` : who.anonId;
  if (subject) {
    const verdict = await store.rateLimit(
      `events:${subject}`,
      RATE_LIMITS.appEvent.windowSeconds,
      RATE_LIMITS.appEvent.max,
    );
    // Silently. A browser hitting the ceiling is a bug in a loop somewhere, and
    // telling it so just makes the loop faster.
    if (!verdict.allowed) return accepted;
  }

  await store.recordAppEvent({
    eventName: parsed.data.event,
    anonymousSessionId: who.anonId,
    authUserId: who.authUserId,
    ipHash: who.ipHash,
    path: parsed.data.path,
    serviceId: parsed.data.serviceId,
    journeyId: parsed.data.journeyId,
    metadata: parsed.data.metadata,
  });

  return accepted;
}
