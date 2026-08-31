import { CAPACITY } from "@ariane/voice";
import { NextResponse } from "next/server";
import { notConfigured, runtime } from "../shared";

/**
 * GET /api/voice/traffic — how many of the lines are in use right now.
 *
 * Three numbers and nothing else. Not who is talking, not what about, not
 * where from: "four lines busy" is public and every identity behind it is
 * not. §10.
 *
 * It exists because "Talk to Ariane" on a demo line is a promise the page
 * cannot always keep, and a caller who can see nine of ten lines lit knows
 * why they are about to be queued before they press anything. §23.
 *
 * ponytail: polled, not pushed. A count that is ten seconds stale is still a
 * count; put it on a socket if it ever needs to be exact.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const voice = runtime();
  if (!voice) return notConfigured();

  try {
    return NextResponse.json(await voice.capacity.load());
  } catch (error) {
    // The store being unreachable is worth a log and not worth a red panel on
    // a page whose actual job still works. Zero busy is the honest guess: it
    // says "go ahead and try", which is what the caller was going to do.
    console.warn("voice traffic: could not read the lines", error instanceof Error ? error.message : error);
    return NextResponse.json({ active: 0, max: CAPACITY.maxConcurrentCalls, queued: 0 });
  }
}
