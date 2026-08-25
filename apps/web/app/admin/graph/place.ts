import type { GraphEdge, GraphNode } from "@ariane/core";

/**
 * Layered left to right layout. The goal sits in column zero and every edge
 * pushes its target one column right, so distance from the goal is literally
 * horizontal distance on screen.
 *
 * Two things were wrong with the first version and both showed up the moment a
 * real journey was drawn rather than a five node fixture.
 *
 * The layering was a depth first longest path walk with a visited guard that
 * only skipped a node when the new depth was no deeper. On a dense subgraph
 * that re-walks the same node once per distinct path into it, which is
 * exponential; driving licence is 35 nodes and 52 edges and got away with it,
 * and nothing about the graph promises the next one will. It is now Kahn's
 * order and one linear pass, which is both faster and shorter.
 *
 * The ordering inside a column was insertion order, which is whatever order
 * the compiler happened to emit. Twenty documents in one column with their
 * edges arriving in arbitrary rows is the spaghetti the old comment predicted.
 * Sorting each column by the average row of what points at it is the cheap half
 * of crossing minimisation, and on this graph it is the half that matters.
 *
 * Limitation: barycentre sweeps, no crossing count, no node size awareness. ELK
 * or dagre if a journey ever needs more than this.
 */

const COLUMN = 260;

/**
 * Row pitch, and it is a legibility setting rather than a spacing one. The
 * canvas is fitted to the panel, so a tall thin graph is zoomed out until the
 * labels stop being words. Twenty documents in one column at the old 92 put
 * driving licence at roughly 40% zoom. 70 is the tightest that still clears a
 * two line node, and it buys back about a third of the type size.
 */
const ROW = 70;
const SWEEPS = 4;

export interface Placed {
  id: string;
  x: number;
  y: number;
  column: number;
}

export function place(nodes: GraphNode[], edges: GraphEdge[], root: string): Placed[] {
  const ids = new Set(nodes.map((n) => n.id));
  // Edges pointing back at the goal are dropped: nothing belongs to the left of
  // the thing you asked for, and keeping them would make the goal a cycle
  // member and park it in the last column.
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to && e.to !== root);

  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of live) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e.from);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // ------------------------------------------------------------- which column
  //
  // Longest path from anything with nothing pointing at it, which for a
  // compiled journey is the goal. Kahn's order guarantees every predecessor is
  // final before a node is read, so one pass is enough.
  const column = new Map<string, number>();
  const pending = new Map(indegree);
  const queue = nodes.filter((n) => (pending.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) column.set(id, 0);

  for (let at = 0; at < queue.length; at++) {
    const id = queue[at]!;
    const depth = column.get(id) ?? 0;
    for (const next of out.get(id) ?? []) {
      column.set(next, Math.max(column.get(next) ?? 0, depth + 1));
      const left = (pending.get(next) ?? 0) - 1;
      pending.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  // The source data is allowed to contain a cycle. Whatever Kahn could not
  // drain is one, and it gets parked past the widest thing we did lay out
  // rather than dropped, because a node nobody drew is a fact nobody can check.
  const deepest = Math.max(0, ...column.values());
  for (const n of nodes) if (!column.has(n.id) || (pending.get(n.id) ?? 0) > 0) column.set(n.id, deepest + 1);

  // ---------------------------------------------------------------- which row
  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const col = column.get(n.id) ?? 0;
    (columns.get(col) ?? columns.set(col, []).get(col)!).push(n.id);
  }

  const row = new Map<string, number>();
  for (const list of columns.values()) list.forEach((id, i) => row.set(id, i));

  const barycentre = (id: string, from: Map<string, string[]>) => {
    const neighbours = (from.get(id) ?? []).map((other) => row.get(other)).filter((r) => r !== undefined);
    return neighbours.length ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length : row.get(id)!;
  };

  const order = [...columns.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    // Forward, then back, so a column is pulled into line with both sides.
    const passes = sweep % 2 ? [...order].reverse() : order;
    const look = sweep % 2 ? out : into;
    for (const col of passes) {
      const list = columns.get(col)!;
      const key = new Map(list.map((id) => [id, barycentre(id, look)]));
      list.sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
      list.forEach((id, i) => row.set(id, i));
    }
  }

  // Centre every column against the tallest one, so a lone node sits opposite
  // the middle of the twenty it points at instead of level with the first.
  const tallest = Math.max(...[...columns.values()].map((l) => l.length));

  return nodes.map((n) => {
    const col = column.get(n.id) ?? 0;
    const list = columns.get(col)!;
    const offset = (tallest - list.length) / 2;
    return { id: n.id, x: col * COLUMN, y: (row.get(n.id)! + offset) * ROW, column: col };
  });
}
