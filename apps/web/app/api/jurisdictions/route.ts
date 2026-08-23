import { loadLiveGraph } from "@ariane/core/server";
import { NextResponse } from "next/server";

/**
 * GET /api/jurisdictions?parent=IN-GJ
 *
 * The district list, from the jurisdiction rows rather than an array in a
 * component. Gujarat gained a district in 2013 and will gain another one
 * eventually, and when it does that should be an insert, not a deploy.
 */
export async function GET(request: Request) {
  const parent = new URL(request.url).searchParams.get("parent") ?? "IN-GJ";
  const { jurisdictions } = await loadLiveGraph();

  return NextResponse.json({
    parent,
    jurisdictions: jurisdictions
      .filter((j) => j.parentId === parent)
      .map((j) => ({ id: j.id, name: j.name, level: j.level }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
