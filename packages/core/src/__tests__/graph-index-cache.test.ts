import { describe, expect, it } from "vitest";
import { loadGraph } from "../data/providers";
import { GraphIndex } from "../graph";
import { JourneyCompiler, graphIndexFor } from "../journey";
import type { GraphData } from "../types";

/**
 * The cache is invisible when it works and produces stale answers when it is
 * wrong, which is the worst pair of properties a thing can have. So: prove it
 * hits, and prove a different graph never sees another graph's index.
 */
describe("the graph index is built once per graph", () => {
  it("hands the same index to two compilers over the same data", () => {
    const data = loadGraph();
    expect(new JourneyCompiler(data).graph).toBe(new JourneyCompiler(data).graph);
  });

  it("does not hand one graph's index to another", () => {
    const a = loadGraph();
    const b = structuredClone(a) as GraphData;
    expect(graphIndexFor(a)).not.toBe(graphIndexFor(b));
  });

  it("indexes an edited graph as edited, because editing means a new object", () => {
    const data = loadGraph();
    const before = graphIndexFor(data).nodes.size;
    const edited = { ...data, nodes: data.nodes.slice(0, 5) };
    expect(graphIndexFor(edited).nodes.size).toBe(5);
    expect(graphIndexFor(data).nodes.size).toBe(before);
  });

  it("still answers the same as a fresh index", () => {
    const data = loadGraph();
    const fresh = new GraphIndex(data);
    const cached = graphIndexFor(data);
    const id = data.nodes[0]!.id;
    expect(cached.outgoing(id).map((e) => e.id)).toEqual(fresh.outgoing(id).map((e) => e.id));
    expect(cached.nodes.size).toBe(fresh.nodes.size);
  });
});
