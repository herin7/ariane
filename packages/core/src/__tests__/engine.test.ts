import { describe, expect, it } from "vitest";
import { evaluateCondition, unresolvedFields } from "../condition.js";
import { filterEdges, topologicalSort, traverse } from "../graph.js";
import { JurisdictionIndex, appliesTo, specificity } from "../jurisdiction.js";
import { evaluateRequirementGroup } from "../requirements.js";
import type { GraphEdge, Jurisdiction, RequirementGroup } from "../types.js";

/** Engine unit tests. No government data in here, only mechanics. */

const edge = (id: string, from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id,
  from,
  to,
  type: "REQUIRES",
  verificationStatus: "VERIFIED",
  ...extra,
});

describe("conditions", () => {
  it("returns UNKNOWN for a field nobody has answered, which is what becomes a question", () => {
    expect(evaluateCondition({ field: "age", operator: "GTE", value: 18 }, {})).toBe("UNKNOWN");
    expect(evaluateCondition({ field: "age", operator: "GTE", value: 18 }, { age: 25 })).toBe("TRUE");
    expect(evaluateCondition({ field: "age", operator: "GTE", value: 18 }, { age: 16 })).toBe("FALSE");
  });

  it("treats possession as closed world, so EXISTS never needs asking", () => {
    expect(evaluateCondition({ field: "document:aadhaar", operator: "EXISTS" }, {})).toBe("FALSE");
    expect(evaluateCondition({ field: "document:aadhaar", operator: "NOT_EXISTS" }, {})).toBe("TRUE");
    expect(unresolvedFields({ field: "document:aadhaar", operator: "EXISTS" }, {})).toEqual([]);
  });

  it("sinks a conjunction on one FALSE but holds UNKNOWN otherwise", () => {
    const c = { all: [{ field: "a", operator: "EQ" as const, value: 1 }, { field: "b", operator: "EQ" as const, value: 2 }] };
    expect(evaluateCondition(c, { a: 9 })).toBe("FALSE");
    expect(evaluateCondition(c, { a: 1 })).toBe("UNKNOWN");
    expect(evaluateCondition(c, { a: 1, b: 2 })).toBe("TRUE");
  });

  it("carries a disjunction on one TRUE", () => {
    const c = { any: [{ field: "a", operator: "EQ" as const, value: 1 }, { field: "b", operator: "EQ" as const, value: 2 }] };
    expect(evaluateCondition(c, { a: 1 })).toBe("TRUE");
    expect(evaluateCondition(c, { a: 9 })).toBe("UNKNOWN");
    expect(evaluateCondition(c, { a: 9, b: 9 })).toBe("FALSE");
  });

  it("compares across the string and number boundary, because forms are stringly typed", () => {
    expect(evaluateCondition({ field: "age", operator: "GTE", value: 18 }, { age: "25" })).toBe("TRUE");
    expect(evaluateCondition({ field: "state", operator: "EQ", value: "Gujarat" }, { state: "gujarat" })).toBe("TRUE");
  });

  it("lists only the fields actually holding up a decision", () => {
    const c = {
      all: [
        { field: "answered", operator: "EQ" as const, value: 1 },
        { field: "missing", operator: "EQ" as const, value: 2 },
      ],
    };
    expect(unresolvedFields(c, { answered: 1 })).toEqual(["missing"]);
  });
});

describe("jurisdiction", () => {
  const list: Jurisdiction[] = [
    { id: "IN", level: "COUNTRY", name: "India" },
    { id: "IN-GJ", parentId: "IN", level: "STATE", name: "Gujarat" },
    { id: "IN-GJ-AHMEDABAD", parentId: "IN-GJ", level: "DISTRICT", name: "Ahmedabad" },
    { id: "IN-MH", parentId: "IN", level: "STATE", name: "Maharashtra" },
  ];
  const index = new JurisdictionIndex(list);

  it("resolves down the hierarchy, most specific first", () => {
    expect(index.resolve({ country: "India", state: "Gujarat", district: "Ahmedabad" })?.chain).toEqual([
      "IN-GJ-AHMEDABAD",
      "IN-GJ",
      "IN",
    ]);
  });

  it("stops gracefully at a level it does not recognise", () => {
    const r = index.resolve({ country: "India", state: "Gujarat", district: "Nowhere" });
    expect(r?.chain).toEqual(["IN-GJ", "IN"]);
  });

  it("applies national rules everywhere and another state's rules nowhere", () => {
    const chain = ["IN-GJ-AHMEDABAD", "IN-GJ", "IN"];
    expect(appliesTo(undefined, chain)).toBe(true);
    expect(appliesTo("IN", chain)).toBe(true);
    expect(appliesTo("IN-MH", chain)).toBe(false);
  });

  it("scores a district rule above a state rule above a national one", () => {
    const chain = ["IN-GJ-AHMEDABAD", "IN-GJ", "IN"];
    expect(specificity("IN-GJ-AHMEDABAD", chain)).toBeGreaterThan(specificity("IN-GJ", chain));
    expect(specificity("IN-GJ", chain)).toBeGreaterThan(specificity("IN", chain));
    expect(specificity("IN-MH", chain)).toBe(-1);
  });
});

describe("edge filtering", () => {
  const chain = ["IN-GJ", "IN"];

  it("drops edges scoped to another state", () => {
    const kept = filterEdges([edge("a", "x", "y", { jurisdictionId: "IN-MH" })], { chain, facts: {} });
    expect(kept).toHaveLength(0);
  });

  it("drops FALSE edges and hides UNKNOWN ones unless asked to keep them", () => {
    const conditional = edge("a", "x", "y", { condition: { field: "age", operator: "GTE", value: 40 } });
    expect(filterEdges([conditional], { chain, facts: { age: 20 } })).toHaveLength(0);
    expect(filterEdges([conditional], { chain, facts: {} })).toHaveLength(0);
    expect(filterEdges([conditional], { chain, facts: {}, keepUnknown: true })).toHaveLength(1);
  });

  it("never silently suppresses a conflicting source, it just ranks it lower", () => {
    const national = edge("a", "x", "y", { jurisdictionId: "IN" });
    const state = edge("b", "x", "y", { jurisdictionId: "IN-GJ" });
    const kept = filterEdges([national, state], { chain, facts: {} });
    expect(kept.map((k) => k.edge.id)).toEqual(["b", "a"]);
  });

  it("ignores rejected edges and expired ones", () => {
    expect(filterEdges([edge("a", "x", "y", { verificationStatus: "REJECTED" })], { chain, facts: {} })).toHaveLength(0);
    const expired = edge("b", "x", "y", { validUntil: "2020-01-01" });
    expect(filterEdges([expired], { chain, facts: {}, asOf: "2026-08-23" })).toHaveLength(0);
  });
});

describe("traversal", () => {
  const graph: Record<string, GraphEdge[]> = {
    a: [edge("ab", "a", "b"), edge("ac", "a", "c")],
    b: [edge("bd", "b", "d")],
    c: [edge("cd", "c", "d")],
    d: [],
  };

  it("reaches everything once", () => {
    const r = traverse(["a"], (id) => graph[id] ?? []);
    expect(r.visited).toEqual(["a", "b", "c", "d"]);
    expect(r.edges).toHaveLength(4);
  });

  it("records a cycle and keeps going instead of throwing", () => {
    const cyclic: Record<string, GraphEdge[]> = { a: [edge("ab", "a", "b")], b: [edge("ba", "b", "a")] };
    const r = traverse(["a"], (id) => cyclic[id] ?? []);
    expect(r.cycles).toHaveLength(1);
    expect(r.visited).toEqual(["a", "b"]);
  });
});

describe("topological sort", () => {
  it("puts a dependency before its dependent", () => {
    const { order, unordered } = topologicalSort(["dl", "ll"], [["ll", "dl"]]);
    expect(order).toEqual(["ll", "dl"]);
    expect(unordered).toEqual([]);
  });

  it("is stable across runs, ties broken by the caller's order", () => {
    const run = () => topologicalSort(["c", "a", "b"], []).order;
    expect(run()).toEqual(["c", "a", "b"]);
    expect(run()).toEqual(run());
  });

  it("does not let parallel edges inflate indegree", () => {
    const { unordered } = topologicalSort(["a", "b"], [["a", "b"], ["a", "b"]]);
    expect(unordered).toEqual([]);
  });

  it("reports nodes stuck in a cycle rather than dropping them", () => {
    const { order, unordered } = topologicalSort(["a", "b"], [["a", "b"], ["b", "a"]]);
    expect(unordered.sort()).toEqual(["a", "b"]);
    expect(order.sort()).toEqual(["a", "b"]);
  });
});

describe("requirement groups", () => {
  const group = (mode: RequirementGroup["mode"], extra: Partial<RequirementGroup> = {}): RequirementGroup => ({
    id: "g",
    ownerNodeId: "group:proof",
    mode,
    members: [{ nodeId: "d:aadhaar" }, { nodeId: "d:voter" }, { nodeId: "d:passport" }],
    ...extra,
  });
  const ctx = (held: string[] = [], facts = {}) => ({ held: new Set(held), facts, chain: ["IN"] });

  it("ANY_OF is satisfied by one document, not six", () => {
    const r = evaluateRequirementGroup(group("ANY_OF"), ctx(["d:voter"]));
    expect(r.minimumRequired).toBe(1);
    expect(r.satisfied).toBe("TRUE");
    expect(r.satisfiedMembers).toEqual(["d:voter"]);
  });

  it("ANY_OF with nothing held is not satisfied", () => {
    expect(evaluateRequirementGroup(group("ANY_OF"), ctx()).satisfied).toBe("FALSE");
  });

  it("ALL_OF needs every applicable member", () => {
    expect(evaluateRequirementGroup(group("ALL_OF"), ctx(["d:aadhaar", "d:voter"])).satisfied).toBe("FALSE");
    expect(evaluateRequirementGroup(group("ALL_OF"), ctx(["d:aadhaar", "d:voter", "d:passport"])).satisfied).toBe("TRUE");
  });

  it("AT_LEAST_N counts", () => {
    const g = group("AT_LEAST_N", { minimumRequired: 2 });
    expect(evaluateRequirementGroup(g, ctx(["d:aadhaar"])).satisfied).toBe("FALSE");
    expect(evaluateRequirementGroup(g, ctx(["d:aadhaar", "d:voter"])).satisfied).toBe("TRUE");
  });

  it("drops a member whose own condition rules it out, and does not count it against you", () => {
    const g = group("ALL_OF", {
      members: [{ nodeId: "d:aadhaar" }, { nodeId: "d:income", condition: { field: "category", operator: "EQ", value: "SC" } }],
    });
    const r = evaluateRequirementGroup(g, ctx(["d:aadhaar"], { category: "GENERAL" }));
    expect(r.inapplicableMembers).toEqual(["d:income"]);
    expect(r.satisfied).toBe("TRUE");
  });

  it("stays UNKNOWN while a member's condition is unanswered", () => {
    const g = group("ANY_OF", {
      members: [{ nodeId: "d:income", condition: { field: "category", operator: "EQ", value: "SC" } }],
    });
    expect(evaluateRequirementGroup(g, ctx()).satisfied).toBe("UNKNOWN");
  });

  it("is vacuously satisfied when scoped to another state", () => {
    expect(evaluateRequirementGroup(group("ALL_OF", { jurisdictionId: "IN-MH" }), ctx()).satisfied).toBe("TRUE");
  });

  it("recurses into a nested group without hanging on a self referential one", () => {
    const outer = group("ANY_OF", { id: "outer", ownerNodeId: "group:outer", members: [{ nodeId: "group:inner" }] });
    const inner = group("ANY_OF", { id: "inner", ownerNodeId: "group:inner", members: [{ nodeId: "d:aadhaar" }] });
    const selfRef = group("ANY_OF", { id: "loop", ownerNodeId: "group:loop", members: [{ nodeId: "group:loop" }] });
    const groupsFor = (id: string) =>
      id === "group:inner" ? [inner] : id === "group:loop" ? [selfRef] : [];

    expect(evaluateRequirementGroup(outer, { ...ctx(["d:aadhaar"]), groupsFor }).satisfied).toBe("TRUE");
    expect(evaluateRequirementGroup(outer, { ...ctx(), groupsFor }).satisfied).toBe("FALSE");
    expect(evaluateRequirementGroup(selfRef, { ...ctx(), groupsFor }).satisfied).toBe("FALSE");
  });
});
