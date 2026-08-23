import { resolveIntent } from "@ariane/core";
import { loadLiveGraph } from "@ariane/core/server";
import { NextResponse } from "next/server";

/**
 * POST /api/intents/resolve
 *
 * Plain language to candidate goals. Returns candidates rather than picking
 * one, because guessing wrong here sends someone to the wrong office.
 */
export async function POST(request: Request) {
  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const matches = resolveIntent(await loadLiveGraph(), text);
  return NextResponse.json({ query: text, matches });
}
