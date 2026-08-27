import { CAPACITY, RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { caller } from "../../caller";
import { notConfigured, runtime } from "../shared";

/**
 * POST   /api/voice/queue          — take a ticket.
 * GET    /api/voice/queue?ticket=… — where am I.
 * DELETE /api/voice/queue?ticket=… — leave the line.
 *
 * §5. Nothing here creates a realtime session, mints a credential or opens a
 * socket to a model, and that is the entire reason the queue exists: waiting
 * has to be free or it is not queueing, it is idling ten paid connections.
 *
 * There is no position parameter anywhere in this file. A ticket's place is
 * `created_at` in Postgres and the only way to improve it is to have arrived
 * earlier. §18.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const who = await caller(request);
  const subject = who.authUserId ? `user:${who.authUserId}` : who.ipHash ? `ip:${who.ipHash}` : undefined;
  if (subject) {
    const verdict = await voice.ops.rateLimit(
      `voice:queue:${subject}`,
      RATE_LIMITS.voiceQueue.windowSeconds,
      RATE_LIMITS.voiceQueue.max,
    );
    if (!verdict.allowed) {
      return NextResponse.json({ error: "Too many attempts. Give it a minute." }, { status: 429 });
    }
  }

  const { ticket, view } = await voice.capacity.join({ authUserId: who.authUserId, ipHash: who.ipHash });
  await voice.ops.recordAppEvent({
    eventName: "voice_queue_joined",
    authUserId: who.authUserId,
    anonymousSessionId: who.anonId,
    ipHash: who.ipHash,
    metadata: { position: view.position ?? 0 },
  });

  return NextResponse.json({ ticket, ...view, pollMs: CAPACITY.queuePollMs, max: CAPACITY.maxConcurrentCalls });
}

export async function GET(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket) return NextResponse.json({ error: "ticket is required" }, { status: 400 });

  /**
   * The ticket is the only credential, and it is a uuid Postgres generated.
   * Polling somebody else's would need it guessed, and what it yields is a
   * position and a claim token for a slot the guesser then has to race the
   * rightful holder for — which `voice_queue_claim` settles by consuming the
   * ticket exactly once. There is no user data behind it to leak.
   */
  const view = await voice.capacity.poll(ticket);
  return NextResponse.json({ ...view, pollMs: CAPACITY.queuePollMs, max: CAPACITY.maxConcurrentCalls });
}

export async function DELETE(request: Request) {
  const voice = runtime();
  if (!voice) return notConfigured();

  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket) return NextResponse.json({ error: "ticket is required" }, { status: 400 });

  // Already gone is a success, same as hanging up twice.
  await voice.capacity.leave(ticket);
  return NextResponse.json({ left: true });
}
