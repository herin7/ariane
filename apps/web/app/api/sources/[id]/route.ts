import { loadGraph } from "@ariane/core";
import { NextResponse } from "next/server";

const sources = new Map(loadGraph().sources.map((s) => [s.id, s]));

/** GET /api/sources/:id  Where a claim came from, so anyone can go and check. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = sources.get(decodeURIComponent(id));
  return source
    ? NextResponse.json(source)
    : NextResponse.json({ error: `No source ${id}` }, { status: 404 });
}
