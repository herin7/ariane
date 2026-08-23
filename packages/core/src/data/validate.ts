import { topologicalSort } from "../graph.js";
import type { GraphData, SourceRef } from "../types.js";

/**
 * Data integrity checks. The graph is hand seeded from official pages today
 * and machine extracted later, and both routes produce the same failure modes:
 * a dangling id, a fact with no evidence, an OR rule modelled as six mandatory
 * documents. This runs in CI and in `pnpm graph:validate`.
 */

export interface GraphIssue {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  /** Node, edge, group or source id the issue is about. */
  subject?: string;
}

export function validateGraph(data: GraphData): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const error = (code: string, message: string, subject?: string) =>
    issues.push({ severity: "ERROR", code, message, subject });
  const warn = (code: string, message: string, subject?: string) =>
    issues.push({ severity: "WARNING", code, message, subject });

  const jurisdictions = new Set(data.jurisdictions.map((j) => j.id));
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const sources = new Set(data.sources.map((s) => s.id));

  duplicates(data.jurisdictions.map((j) => j.id)).forEach((id) => error("DUPLICATE_JURISDICTION", `Jurisdiction ${id} declared twice`, id));
  duplicates(data.nodes.map((n) => n.id)).forEach((id) => error("DUPLICATE_NODE", `Node ${id} declared twice`, id));
  duplicates(data.edges.map((e) => e.id)).forEach((id) => error("DUPLICATE_EDGE", `Edge ${id} declared twice`, id));
  duplicates(data.sources.map((s) => s.id)).forEach((id) => error("DUPLICATE_SOURCE", `Source ${id} declared twice`, id));
  duplicates(data.requirementGroups.map((g) => g.id)).forEach((id) => error("DUPLICATE_GROUP", `Group ${id} declared twice`, id));
  duplicates(data.questions.map((q) => q.field)).forEach((f) => error("DUPLICATE_QUESTION", `Question ${f} declared twice`, f));

  for (const j of data.jurisdictions) {
    if (j.parentId && !jurisdictions.has(j.parentId)) {
      error("DANGLING_PARENT", `Jurisdiction ${j.id} points at unknown parent ${j.parentId}`, j.id);
    }
  }

  const checkRefs = (refs: SourceRef[] | undefined, subject: string) => {
    for (const ref of refs ?? []) {
      if (!sources.has(ref.sourceId)) error("DANGLING_SOURCE", `${subject} cites unknown source ${ref.sourceId}`, subject);
      else if (!ref.evidence?.trim()) warn("NO_EVIDENCE", `${subject} cites ${ref.sourceId} with no verbatim quote`, subject);
    }
  };

  for (const node of data.nodes) {
    if (node.jurisdictionId && !jurisdictions.has(node.jurisdictionId)) {
      error("UNKNOWN_JURISDICTION", `Node ${node.id} is scoped to unknown jurisdiction ${node.jurisdictionId}`, node.id);
    }
    if (!node.id.includes(":")) warn("UNNAMESPACED_ID", `Node ${node.id} is missing its type prefix`, node.id);
    checkRefs(node.sources, `Node ${node.id}`);

    const needsSource = node.type === "SERVICE" || node.type === "DOCUMENT" || node.type === "PORTAL" || node.type === "OFFICE";
    if (needsSource && !node.sources?.length) {
      warn("UNSOURCED_NODE", `${node.type} ${node.id} has no source. It will render as "not verified yet".`, node.id);
    }
    if (node.type === "MOBILE_APP" && !node.metadata?.androidAppId && !node.metadata?.iosAppId) {
      warn("APP_WITHOUT_STORE_ID", `Mobile app ${node.id} has no store id. Never guess one.`, node.id);
    }
  }

  for (const edge of data.edges) {
    if (!nodes.has(edge.from)) error("DANGLING_EDGE", `Edge ${edge.id} starts at unknown node ${edge.from}`, edge.id);
    if (!nodes.has(edge.to)) error("DANGLING_EDGE", `Edge ${edge.id} ends at unknown node ${edge.to}`, edge.id);
    if (edge.jurisdictionId && !jurisdictions.has(edge.jurisdictionId)) {
      error("UNKNOWN_JURISDICTION", `Edge ${edge.id} is scoped to unknown jurisdiction ${edge.jurisdictionId}`, edge.id);
    }
    if (edge.validFrom && edge.validUntil && edge.validFrom > edge.validUntil) {
      error("INVERTED_WINDOW", `Edge ${edge.id} is valid from after it is valid until`, edge.id);
    }
    checkRefs(edge.sources, `Edge ${edge.id}`);
  }

  for (const group of data.requirementGroups) {
    const owner = nodes.get(group.ownerNodeId);
    if (!owner) error("DANGLING_GROUP_OWNER", `Group ${group.id} is owned by unknown node ${group.ownerNodeId}`, group.id);
    if (!group.members.length) error("EMPTY_GROUP", `Group ${group.id} has no members`, group.id);
    if (group.mode === "AT_LEAST_N" && !group.minimumRequired) {
      error("MISSING_MINIMUM", `Group ${group.id} is AT_LEAST_N but does not say N`, group.id);
    }
    if (group.mode !== "ALL_OF" && owner && owner.type !== "DOCUMENT_GROUP") {
      warn(
        "ALTERNATIVES_WITHOUT_GROUP_NODE",
        `Group ${group.id} offers alternatives but hangs off a ${owner.type}. Model it as a DOCUMENT_GROUP node so the citizen sees one named choice.`,
        group.id,
      );
    }
    if (data.requirementGroups.filter((g) => g.ownerNodeId === group.ownerNodeId).length > 1) {
      warn("MULTIPLE_GROUPS_PER_NODE", `Node ${group.ownerNodeId} owns more than one group. Only the first renders as alternatives.`, group.id);
    }
    for (const member of group.members) {
      if (!nodes.has(member.nodeId)) error("DANGLING_MEMBER", `Group ${group.id} lists unknown member ${member.nodeId}`, group.id);
    }
    checkRefs(group.sources, `Group ${group.id}`);
  }

  // A cycle here means a citizen would be told to do A before B before A.
  const pairs: [string, string][] = [];
  for (const edge of data.edges) {
    if (edge.type === "REQUIRES" || edge.type === "DEPENDS_ON") pairs.push([edge.to, edge.from]);
    else if (edge.type === "PRODUCES" || edge.type === "NEXT" || edge.type === "BLOCKS") pairs.push([edge.from, edge.to]);
  }
  for (const id of topologicalSort([...nodes.keys()], pairs).unordered) {
    error("DEPENDENCY_CYCLE", `Node ${id} sits in a dependency cycle`, id);
  }

  return issues;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
