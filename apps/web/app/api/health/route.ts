import { activeGraphProvider } from "@ariane/core/server";
import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * What a load balancer, an uptime check and a person at 2am all want, which is
 * the same thing: is this process able to answer a citizen, and off which
 * plane.
 *
 * The plane is the interesting field. A deployment that has quietly fallen back
 * to a snapshot is still serving real Gujarat rows and is fine; one that says
 * `fixture` is serving four invented nodes about a tree felling permit and is
 * an incident, even though every page still returns 200. That difference is
 * invisible from the outside and is exactly what has to be alertable.
 *
 * Deliberately does not load the graph. A health check that costs a Supabase
 * round trip becomes a health check that fails under the load it was added to
 * diagnose, and the probe itself would be the thing keeping the connection
 * pool busy.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { origin, describe } = activeGraphProvider();

  return NextResponse.json(
    { ok: origin !== "fixture", plane: origin, source: describe },
    // 503 on fixtures so a probe fails rather than a person noticing. This is
    // the same refusal `loadLiveGraph` makes in production, said early.
    { status: origin === "fixture" && process.env.NODE_ENV === "production" ? 503 : 200 },
  );
}
