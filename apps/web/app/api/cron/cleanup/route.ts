import { RETENTION_DAYS } from "@ariane/voice";
import { supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * GET /api/cron/cleanup — delete what we said we would not keep.
 *
 * §17. Retention is a promise on a page nobody reads unless it is kept, so it
 * is one scheduled request and one Postgres function: transcripts at 30 days,
 * security events at 90, spent queue rows and expired sessions at 7.
 *
 * Vercel Cron, which is already part of the platform this deploys to, so §17's
 * "do not add an external cron provider" costs nothing: the schedule is in
 * `vercel.json` and Vercel sends `authorization: Bearer $CRON_SECRET`. Any
 * scheduler that can make an authenticated GET works the same way, and it is
 * safe to run by hand or twice in a row — deleting rows older than a cutoff is
 * idempotent by construction.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret, no endpoint. An unauthenticated delete is worse than no
    // retention policy at all.
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const offered = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const want = Buffer.from(secret);
  const got = Buffer.from(offered);
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const config = supabaseConfigFromEnv();
  if (!config) return NextResponse.json({ error: "No database" }, { status: 503 });

  const { data, error } = await supabaseClient(config).rpc("ariane_cleanup", {
    p_transcript_days: RETENTION_DAYS.transcripts,
    p_security_days: RETENTION_DAYS.securityEvents,
    p_event_days: RETENTION_DAYS.appEvents,
    p_ephemeral_days: RETENTION_DAYS.ephemeral,
  });

  if (error) {
    console.error("cleanup failed", error.message);
    // The message, not the object: a PostgREST error carries the request it
    // failed on, and that request carries a key. §8.
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }

  return NextResponse.json({ deleted: data });
}
