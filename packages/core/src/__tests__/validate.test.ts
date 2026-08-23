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

/**
 * Requirement groups are the one place the graph tells a citizen "you may bring
 * this OR that", so a group that is wrong does not merely fail to help, it sends
 * somebody to a counter with the wrong paper. The compiler now generates these
 * from page text, so every way a generated group can be malformed gets a check.
 */
describe("a malformed choice does not reach a citizen", () => {
  const group = (data: GraphData) => data.requirementGroups.find((g) => g.mode === "ANY_OF")!;

  it("catches a choice with nothing to choose", () => {
    const data = clone();
    group(data).members = [];
    expect(errors(data)).toContain("EMPTY_GROUP");
  });

  it("catches a choice of one", () => {
    const data = clone();
    group(data).members = [group(data).members[0]!];
    expect(errors(data)).toContain("SINGLE_MEMBER_CHOICE");
  });

  it("catches asking for more members than the group has", () => {
    const data = clone();
    const g = group(data);
    g.mode = "AT_LEAST_N";
    g.minimumRequired = g.members.length + 1;
    expect(errors(data)).toContain("IMPOSSIBLE_MINIMUM");
  });

  it("catches AT_LEAST_N that never says N", () => {
    const data = clone();
    group(data).mode = "AT_LEAST_N";
    expect(errors(data)).toContain("MISSING_MINIMUM");
  });

  it("catches the same document listed twice as two alternatives", () => {
    const data = clone();
    const g = group(data);
    g.members = [...g.members, { nodeId: g.members[0]!.nodeId }];
    expect(errors(data)).toContain("DUPLICATE_MEMBER");
  });

  it("catches a group that offers itself", () => {
    const data = clone();
    const g = group(data);
    g.members = [...g.members, { nodeId: g.ownerNodeId }];
    expect(errors(data)).toContain("SELF_REFERENTIAL_GROUP");
  });

  it("catches an alternative nobody can prove is an alternative", () => {
    const data = clone();
    delete group(data).sources;
    expect(errors(data)).toContain("UNSOURCED_GROUP");
  });

  it("catches a mode that is not a mode", () => {
    const data = clone();
    group(data).mode = "ANY_TWO" as never;
    expect(errors(data)).toContain("UNKNOWN_ENUM");
  });

  it("catches a member node that does not exist", () => {
    const data = clone();
    group(data).members = [{ nodeId: "document:invented" }, { nodeId: "document:also_invented" }];
    expect(errors(data)).toContain("DANGLING_MEMBER");
  });

  it("catches an owner node that does not exist", () => {
    const data = clone();
    group(data).ownerNodeId = "document_group:invented";
    expect(errors(data)).toContain("DANGLING_GROUP_OWNER");
  });
});
