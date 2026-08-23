import { describe, expect, it } from "vitest";
import { loadGraph, validateGraph } from "../data/index";
import type { GraphData } from "../types";

/**
 * The graph is rows now, not TypeScript. A misspelt node type used to be a
 * compile error and is not one any more, so these checks are the thing that
 * replaced the compiler. A validator that cannot fail is worse than no
 * validator, so every rule here is proved by breaking the data on purpose.
 */

const clone = (): GraphData => structuredClone(loadGraph());
const errors = (data: GraphData) =>
  validateGraph(data).filter((i) => i.severity === "ERROR").map((i) => i.code);

describe("bad rows do not load quietly", () => {
  it("passes the real seed", () => {
    expect(errors(loadGraph())).toEqual([]);
  });

  it("catches a node type that is not a node type", () => {
    const data = clone();
    data.nodes[0]!.type = "SERVICEE" as never;
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches an edge type that is not an edge type", () => {
    const data = clone();
    data.edges[0]!.type = "REQUIRESS" as never;
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches an actor nobody defined, so nothing silently stops blocking", () => {
    const data = clone();
    data.nodes[0]!.metadata = { ...data.nodes[0]!.metadata, blockedBy: "LANDLORD" as never };
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches a typo in a rule operator, which would otherwise change who qualifies", () => {
    const data = clone();
    const rule = data.nodes.find((n) => n.metadata?.rule && "operator" in n.metadata.rule)!;
    (rule.metadata!.rule as { operator: string }).operator = "GTEE";
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches a source type that would let a blog in next to a government page", () => {
    const data = clone();
    data.sources[0]!.sourceType = "BLOG" as never;
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches a citation whose confidence is not a number between 0 and 1", () => {
    const data = clone();
    const node = data.nodes.find((n) => n.sources?.length)!;
    node.sources![0]!.confidence = 7 as never;
    expect(errors(data)).toContain("BAD_CONFIDENCE");
  });

  it("leaves optional fields optional", () => {
    const data = clone();
    for (const n of data.nodes) delete n.metadata?.blockedBy;
    expect(errors(data)).toEqual([]);
  });
});
