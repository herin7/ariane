import { NextResponse } from "next/server";
import { servicePaused } from "../../pause";

/**
 * GET /api/status — whether the credits notice is on.
 *
 * The website reads the same flag while it renders. The phone cannot, so it
 * asks. Nothing else about the service is in this response.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const paused = await servicePaused();
  return NextResponse.json({ paused }, { headers: { "cache-control": "no-store" } });
}
