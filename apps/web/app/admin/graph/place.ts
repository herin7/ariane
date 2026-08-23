import type { GraphEdge, GraphNode } from "@ariane/core";

/**
 * Layered left to right layout. The goal sits in column zero and every edge
 * pushes its target one column right, so distance from the goal is literally
 * horizontal distance on screen.
 *
 * ponytail: longest path layering, no crossing minimisation. ELK or dagre if
 * the graphs ever get wide enough for the edges to look like spaghetti.
 */

const COLUMN = 260;
const ROW = 92;

export interface Placed {
  id: string;
  x: number;
  y: number;
  column: number;
}

export function place(nodes: GraphNode[], edges: GraphEdge[], root: string): Placed[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }

  const column = new Map<string, number>();
  // Longest path from the root. Depth first with a path guard, because the
  // source data is allowed to contain a cycle and we still have to draw it.
  const walk = (id: string, depth: number, path: Set<string>) => {
    if (path.has(id)) return;
    if ((column.get(id) ?? -1) >= depth) return;
    column.set(id, depth);
    path.add(id);
    for (const next of out.get(id) ?? []) walk(next, depth + 1, path);
    path.delete(id);
  };
  walk(root, 0, new Set());
  // Anything the root cannot reach still gets drawn, parked one column past
  // the widest thing we did reach.
  const orphanColumn = Math.max(0, ...column.values()) + 1;
  for (const n of nodes) if (!column.has(n.id)) column.set(n.id, orphanColumn);

  const perColumn = new Map<number, number>();
  return nodes.map((n) => {
    const col = column.get(n.id) ?? 0;
    const row = perColumn.get(col) ?? 0;
    perColumn.set(col, row + 1);
    return { id: n.id, x: col * COLUMN, y: row * ROW, column: col };
  });
}
