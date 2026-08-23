import { GraphIndex } from "@ariane/core";
import { loadLiveGraph } from "@ariane/core/server";
import { NextResponse } from "next/server";

// Built once per process off whichever graph answered: the database when one
// is configured, the checked in seed when not.
let indexed: Promise<GraphIndex> | undefined;
const graph = () => (indexed ??= loadLiveGraph().then((data) => new GraphIndex(data)));

/** GET /api/graph/nodes/:id  Node plus its edges and inflated provenance. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const index = await graph();
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
