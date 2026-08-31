import { topologicalSort } from "../graph";
import type { Condition, GraphData, SourceRef } from "../types";

/**
 * Data integrity checks. The graph is rows, loaded from seed files today and
 * from the database once it is live, and every route in produces the same
 * failure modes: a dangling id, a fact with no evidence, an OR rule modelled
 * as six mandatory documents. This runs in CI and in `pnpm graph:validate`.
 *
 * The enum checks below are load bearing. While the graph lived in TypeScript
 * a misspelt node type was a compile error. Rows do not get that for free, so
 * the same guarantee is bought back here.
 */

const NODE_TYPES = ["SERVICE", "DOCUMENT", "DOCUMENT_GROUP", "ACTION", "PORTAL", "MOBILE_APP", "OFFICE", "DEPARTMENT", "HELPLINE", "GRIEVANCE_CHANNEL", "VERIFICATION", "PAYMENT", "ELIGIBILITY", "OUTPUT"];
const EDGE_TYPES = ["REQUIRES", "DEPENDS_ON", "PRODUCES", "NEXT", "APPLY_AT", "AVAILABLE_VIA", "VISIT_AT", "HANDLED_BY", "ISSUED_BY", "VERIFIED_BY", "TRACK_AT", "CALL_IF", "ESCALATE_TO", "BLOCKS", "SATISFIES", "ALTERNATIVE_TO"];
const VERIFICATION_STATUSES = ["DISCOVERED", "EXTRACTED", "NORMALIZED", "VERIFIED", "CONFLICTING", "STALE", "REJECTED"];
const SOURCE_TYPES = ["SERVICE_PAGE", "GUIDELINE", "FAQ", "OFFICE_DIRECTORY", "HELPLINE", "MOBILE_APP_INFO", "TRACKING_PAGE", "GRIEVANCE_PAGE", "PDF", "PORTAL_HOME"];
const JURISDICTION_LEVELS = ["COUNTRY", "STATE", "DISTRICT", "TALUKA", "LOCAL_BODY"];
const REQUIREMENT_MODES = ["ALL_OF", "ANY_OF", "AT_LEAST_N"];
const INPUT_TYPES = ["NUMBER", "TEXT", "SINGLE_SELECT", "MULTI_SELECT", "BOOLEAN"];
const ACTORS = ["CITIZEN", "EMPLOYER", "GOVERNMENT", "INSTITUTE", "BANK"];
const CHANNEL_TYPES = ["WEB", "ANDROID_APP", "IOS_APP", "PHYSICAL_OFFICE", "CSC", "PHONE", "EMAIL", "GRIEVANCE_PORTAL"];
const OPERATORS = ["EQ", "NEQ", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "EXISTS", "NOT_EXISTS"];

/**
 * Government bodies that do not live on a `.gov.in` or `.nic.in` name.
 *
 * Ariane sends a citizen to a website. A private company's site dressed as a
 * government service is the one link that can cost them money, so the rule
 * fails closed: a host is refused unless it is a government name or it is on
 * this list, and getting on this list means somebody checked who owns it.
 * A denylist would fail open, which is exactly how tinpan.proteantech.in - a
 * privately held listed company - got cited in the first place.
 *
 * ponytail: a flat list of 12 because that is all there is. If it passes ~50,
 * move it to a reviewed TSV next to docs/research/domains/.
 */
const CITABLE_NON_GOV: Record<string, string> = {
  "bmcgujarat.com": "Bhavnagar Municipal Corporation",
  "gandhinagarmunicipal.com": "Gandhinagar Municipal Corporation",
  "mcjamnagar.com": "Jamnagar Municipal Corporation",
  "gujarattourism.com": "Gujarat Tourism, a state government corporation",
  "gsrtc.in": "Gujarat State Road Transport Corporation",
  "ggrc.co.in": "Gujarat Green Revolution Company, a state PSU",
  "gvc.org.in": "Gujarat Vidyapith, a deemed university",
  "nhb.org.in": "National Housing Bank, wholly owned by the Reserve Bank",
  "mudra.org.in": "MUDRA, a SIDBI subsidiary set up by the Union government",
  "udyamimitra.in": "Udyami Mitra, run by SIDBI",
  "pan.utiitsl.com": "UTIITSL, CIN U65991MH1993GOI072051, a Government of India company",
  "play.google.com": "the app store an official app is listed on, never a claim source",
};

/** The host of a url, or "" if it will not parse. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const citable = (url: string) => {
  const host = hostOf(url);
  // `.invalid` is reserved and can never resolve, so the demo fixture's
  // example.gov.invalid cannot send anybody anywhere. Test data, not a source.
  return !host || host.endsWith(".gov.in") || host.endsWith(".nic.in") || host.endsWith(".gov.invalid") || host in CITABLE_NON_GOV;
};

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

  /** `undefined` passes, an unrecognised value does not. Optional stays optional. */
  const oneOf = (value: unknown, allowed: string[], field: string, subject: string) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string" || !allowed.includes(value)) {
      error("UNKNOWN_ENUM", `${subject} has ${field} ${JSON.stringify(value)}, which is not one of ${allowed.join(", ")}`, subject);
    }
  };

  const checkRefs = (refs: SourceRef[] | undefined, subject: string) => {
    for (const ref of refs ?? []) {
      if (!sources.has(ref.sourceId)) error("DANGLING_SOURCE", `${subject} cites unknown source ${ref.sourceId}`, subject);
      else if (!ref.evidence?.trim()) warn("NO_EVIDENCE", `${subject} cites ${ref.sourceId} with no verbatim quote`, subject);
      oneOf(ref.verificationStatus, VERIFICATION_STATUSES, "verificationStatus", subject);
      if (typeof ref.confidence !== "number" || ref.confidence < 0 || ref.confidence > 1) {
        error("BAD_CONFIDENCE", `${subject} cites ${ref.sourceId} with confidence ${JSON.stringify(ref.confidence)}, expected 0 to 1`, subject);
      }
    }
  };

  /** Rules are the one place a typo silently changes who qualifies. */
  const checkCondition = (condition: Condition | undefined, subject: string) => {
    if (!condition) return;
    const branches = (condition as { all?: Condition[]; any?: Condition[]; not?: Condition });
    if (branches.all || branches.any) {
      for (const child of branches.all ?? branches.any ?? []) checkCondition(child, subject);
      return;
    }
    if (branches.not) return checkCondition(branches.not, subject);
    const predicate = condition as { field?: string; operator?: string };
    if (!predicate.field) return error("BAD_RULE", `${subject} has a rule predicate with no field`, subject);
    oneOf(predicate.operator, OPERATORS, "operator", subject);
  };

  for (const j of data.jurisdictions) oneOf(j.level, JURISDICTION_LEVELS, "level", j.id);

  for (const source of data.sources) {
    oneOf(source.sourceType, SOURCE_TYPES, "sourceType", source.id);
    if (!source.url?.startsWith("http")) error("BAD_SOURCE_URL", `Source ${source.id} has no usable URL`, source.id);
    else if (!citable(source.url)) {
      error("PRIVATE_SOURCE", `Source ${source.id} cites ${hostOf(source.url)}, which is not a government site. If it is a government body, add it to CITABLE_NON_GOV with who owns it.`, source.id);
    }
  }

  for (const q of data.questions) oneOf(q.inputType, INPUT_TYPES, "inputType", q.field);

  for (const node of data.nodes) {
    oneOf(node.type, NODE_TYPES, "type", node.id);
    oneOf(node.metadata?.blockedBy, ACTORS, "metadata.blockedBy", node.id);
    oneOf(node.metadata?.channelType, CHANNEL_TYPES, "metadata.channelType", node.id);
    checkCondition(node.metadata?.rule, `Node ${node.id}`);
    if (node.jurisdictionId && !jurisdictions.has(node.jurisdictionId)) {
      error("UNKNOWN_JURISDICTION", `Node ${node.id} is scoped to unknown jurisdiction ${node.jurisdictionId}`, node.id);
    }
    if (!node.id.includes(":")) warn("UNNAMESPACED_ID", `Node ${node.id} is missing its type prefix`, node.id);
    checkRefs(node.sources, `Node ${node.id}`);

    const needsSource = node.type === "SERVICE" || node.type === "DOCUMENT" || node.type === "PORTAL" || node.type === "OFFICE";
    if (needsSource && !node.sources?.length) {
      warn("UNSOURCED_NODE", `${node.type} ${node.id} has no source. It will render as "not verified yet".`, node.id);
    }
    // A source is what we quote; `metadata.url` is what the citizen is handed
    // and clicks. Same rule, and this is the half that actually reaches them.
    const url = node.metadata?.url;
    if (typeof url === "string" && !citable(url)) {
      error("PRIVATE_URL", `Node ${node.id} sends the citizen to ${hostOf(url)}, which is not a government site.`, node.id);
    }
    if (node.type === "MOBILE_APP" && !node.metadata?.androidAppId && !node.metadata?.iosAppId) {
      warn("APP_WITHOUT_STORE_ID", `Mobile app ${node.id} has no store id. Never guess one.`, node.id);
    }
  }

  for (const edge of data.edges) {
    oneOf(edge.type, EDGE_TYPES, "type", edge.id);
    oneOf(edge.verificationStatus, VERIFICATION_STATUSES, "verificationStatus", edge.id);
    checkCondition(edge.condition, `Edge ${edge.id}`);
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
    oneOf(group.mode, REQUIREMENT_MODES, "mode", group.id);
    checkCondition(group.condition, `Group ${group.id}`);
    for (const member of group.members ?? []) checkCondition(member.condition, `Group ${group.id}`);
    const owner = nodes.get(group.ownerNodeId);
    if (!owner) error("DANGLING_GROUP_OWNER", `Group ${group.id} is owned by unknown node ${group.ownerNodeId}`, group.id);
    if (!group.members.length) error("EMPTY_GROUP", `Group ${group.id} has no members`, group.id);
    if (group.mode === "AT_LEAST_N" && !group.minimumRequired) {
      error("MISSING_MINIMUM", `Group ${group.id} is AT_LEAST_N but does not say N`, group.id);
    }
    // "Bring any two of these two" is not a choice, it is both of them, and the
    // engine would hold the journey forever waiting for a third.
    if (group.mode === "AT_LEAST_N" && group.minimumRequired && group.minimumRequired > group.members.length) {
      error(
        "IMPOSSIBLE_MINIMUM",
        `Group ${group.id} asks for ${group.minimumRequired} of ${group.members.length} member(s), which can never be satisfied`,
        group.id,
      );
    }
    // One alternative is not an alternative. Almost always a list we misread,
    // and it renders as a choice with nothing to choose.
    if (group.mode !== "ALL_OF" && group.members.length === 1) {
      error("SINGLE_MEMBER_CHOICE", `Group ${group.id} is ${group.mode} but offers only one member`, group.id);
    }
    duplicates(group.members.map((m) => m.nodeId)).forEach((id) =>
      error("DUPLICATE_MEMBER", `Group ${group.id} lists ${id} more than once`, group.id),
    );
    if (group.members.some((m) => m.nodeId === group.ownerNodeId)) {
      error("SELF_REFERENTIAL_GROUP", `Group ${group.id} lists its own owner ${group.ownerNodeId} as a member`, group.id);
    }
    // The whole point of the graph. A choice nobody can trace to a page is a
    // choice somebody made up.
    if (!group.sources?.length) {
      error("UNSOURCED_GROUP", `Group ${group.id} cites no source, so nothing proves these are alternatives`, group.id);
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
