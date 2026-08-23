import { loadLiveGraph } from "@ariane/core/server";
import { NextResponse } from "next/server";

let indexed: Promise<Map<string, unknown>> | undefined;
const sources = () =>
  (indexed ??= loadLiveGraph().then((data) => new Map(data.sources.map((s) => [s.id, s]))));

/** GET /api/sources/:id  Where a claim came from, so anyone can go and check. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = (await sources()).get(decodeURIComponent(id));
  return source
    ? NextResponse.json(source)
    : NextResponse.json({ error: `No source ${id}` }, { status: 404 });
}
