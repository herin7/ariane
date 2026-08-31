import { FeedbackBody, RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { caller } from "../caller";
import { ops } from "../ops";

/**
 * POST /api/feedback — a review, or "please cover this service".
 *
 * The opposite of `/api/events` in every way that matters. That route is a
 * beacon: it always says 202, never explains itself, and losing one costs a tick
 * on a chart. This one is somebody's paragraph, so it answers honestly — a
 * refusal says why, and a database that did not take the row says so rather
 * than showing a thank-you over a write that never happened.
 *
 * No account needed. §2: the person best placed to tell us a page is wrong is
 * the person who just hit the wrong page, and they have not signed up.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send some JSON." }, { status: 400 });
  }

  const parsed = FeedbackBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a few words, and keep it under 2000 characters." }, { status: 400 });
  }

  const who = await caller(request);
  const store = ops();

  /**
   * Per person, hourly, five. The limiter is the Postgres one every other route
   * uses, so it holds across Vercel instances; an in-memory counter here would
   * be five per instance and therefore no limit at all.
   */
  const subject = who.authUserId ? `user:${who.authUserId}` : who.ipHash ? `ip:${who.ipHash}` : who.anonId;
  if (subject) {
    const verdict = await store.rateLimit(
      `feedback:${subject}`,
      RATE_LIMITS.feedback.windowSeconds,
      RATE_LIMITS.feedback.max,
    );
    if (!verdict.allowed) {
      return NextResponse.json({ error: "That is a lot of feedback. Try again in an hour." }, { status: 429 });
    }
  }

  const saved = await store.recordFeedback({
    kind: parsed.data.kind,
    message: parsed.data.message,
    rating: parsed.data.rating,
    contact: parsed.data.contact || undefined,
    // Trusted for nothing, stored so an operator knows which page they were on.
    path: parsed.data.path,
    anonymousSessionId: who.anonId,
    authUserId: who.authUserId,
    ipHash: who.ipHash,
  });

  if (!saved) {
    return NextResponse.json({ error: "We could not save that. Try again in a moment." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
