import { loadLiveGraph, resolveIntentDeeply } from "@ariane/core/server";
import { NextResponse } from "next/server";

/**
 * POST /api/intents/resolve
 *
 * Plain language to candidate goals. Returns candidates rather than picking
 * one, because guessing wrong here sends someone to the wrong office.
 *
 * The three passes and every reason behind them now live in
 * `resolveIntentDeeply`, because the voice agent asks the same question and two
 * copies of a confidence floor is one copy too many. This route is the HTTP
 * shape and nothing else.
 */

/**
 * Passes two and three call Sarvam and Bedrock over the network, so this is the
 * one route in the product whose latency belongs to somebody else. A serverless
 * default of a few seconds cuts a slow model off mid-answer and the citizen
 * sees a failure that the fallback would have handled honestly.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const { matches, understoodAs, detectedLanguage, inferred } = await resolveIntentDeeply(
    await loadLiveGraph(),
    text,
  );

  return NextResponse.json({
    query: text,
    matches,
    ...(understoodAs ? { understoodAs, detectedLanguage } : {}),
    ...(inferred ? { inferred } : {}),
  });
}
