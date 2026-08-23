import { GoalNotFoundError, JurisdictionNotFoundError, compileJourney } from "@ariane/core";
import { loadLiveGraph } from "@ariane/core/server";
import type { CompileRequest } from "@ariane/core";
import { NextResponse } from "next/server";

/**
 * POST /api/journeys/compile
 *
 * The whole product in one endpoint. Body is a CompileRequest, response is a
 * CompiledJourney including the questions we still need answered. The client
 * posts back with more answers and gets a shorter, more certain path.
 */
export async function POST(request: Request) {
  let body: CompileRequest;
  try {
    body = (await request.json()) as CompileRequest;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!body?.goal || !body?.jurisdiction?.country) {
    return NextResponse.json({ error: "goal and jurisdiction.country are required" }, { status: 400 });
  }

  try {
    return NextResponse.json(compileJourney(await loadLiveGraph(), body));
  } catch (error) {
    if (error instanceof GoalNotFoundError || error instanceof JurisdictionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
