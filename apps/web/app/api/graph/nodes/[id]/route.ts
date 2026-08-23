import { GraphIndex, loadGraph } from "@ariane/core";
import { NextResponse } from "next/server";

const index = new GraphIndex(loadGraph());

/** GET /api/graph/nodes/:id  Node plus its edges and inflated provenance. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const node = index.node(decodeURIComponent(id));
  if (!node) return NextResponse.json({ error: `No node ${id}` }, { status: 404 });

  return NextResponse.json({
    node,
    sources: index.resolveSources(node.sources),
    outgoing: index.outgoing(node.id),
    incoming: index.incoming(node.id),
    requirementGroups: index.groupsOwnedBy(node.id),
  });
}
