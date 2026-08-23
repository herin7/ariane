/**
 * The ontology. Everything the product knows about government is one of these.
 *
 * Two rules this file exists to enforce:
 *   1. Jurisdiction is data. No engine code ever branches on a state name.
 *   2. A fact without a source is not a fact. Provenance rides on nodes and
 *      edges, not in a side table nobody reads.
 */

// ---------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------

export type JurisdictionLevel =
  | "COUNTRY"
  | "STATE"
  | "DISTRICT"
  | "TALUKA"
  | "LOCAL_BODY";

export interface Jurisdiction {
  /** Stable id, hierarchical by convention: "IN", "IN-GJ", "IN-GJ-AHMEDABAD". */
  id: string;
  parentId?: string;
  level: JurisdictionLevel;
  name: string;
}

/** What the citizen told us about where they live. */
export interface JurisdictionQuery {
  country: string;
  state?: string;
  district?: string;
  taluka?: string;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export type NodeType =
  | "SERVICE"
  | "DOCUMENT"
  | "DOCUMENT_GROUP"
  | "ACTION"
  | "PORTAL"
  | "MOBILE_APP"
  | "OFFICE"
  | "DEPARTMENT"
  | "HELPLINE"
  | "GRIEVANCE_CHANNEL"
  | "VERIFICATION"
  | "PAYMENT"
  | "ELIGIBILITY"
  | "OUTPUT";

export type ChannelType =
  | "WEB"
  | "ANDROID_APP"
  | "IOS_APP"
  | "PHYSICAL_OFFICE"
  | "CSC"
  | "PHONE"
  | "EMAIL"
  | "GRIEVANCE_PORTAL";

/**
 * Who has to act for a node to advance. The difference between "you can fix
 * this" and "no amount of reapplying will fix this" is the whole PF journey.
 */
export type Actor = "CITIZEN" | "EMPLOYER" | "GOVERNMENT" | "INSTITUTE" | "BANK";

export interface NodeMetadata {
  /**
   * Written by the ingestion pipeline, absent on anything a person authored.
   *
   * Not a quality claim in either direction. Every quote on either kind is
   * proved verbatim against a fetched page before it is written. It says who
   * chose the words around the quote, which is what decides a tie: a hand
   * written service wins a name collision, and a machine one may never take a
   * name the seed already answers to.
   */
  machineExtracted?: boolean;

  /** PORTAL / TRACKING / GRIEVANCE_CHANNEL: the official URL. */
  url?: string;
  /** MOBILE_APP: verified store identifiers. Never guessed. */
  androidAppId?: string;
  iosAppId?: string;
  /** How this node is reached, when it is a channel. */
  channelType?: ChannelType;

  /** OFFICE. Only ever populated from an official directory page. */
  officeType?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phoneNumbers?: string[];
  emails?: string[];
  workingHours?: string;

  /** SERVICE / ACTION, citizen-facing guidance. */
  whyRequired?: string;
  whatToDo?: string;
  expectedOutput?: string;
  couldBlock?: string[];
  fee?: string;
  timeline?: string;
  formNumber?: string;
  /**
   * Who the page says qualifies, in the page's own sentences.
   *
   * Not a rule and deliberately not one. An `ELIGIBILITY` node needs a
   * `Condition` over a field the question bank already asks about, and there is
   * no honest way to turn "the beneficiary must be a woman" into one without
   * inventing the field. So the criteria are quoted, not evaluated: the citizen
   * reads them and decides, which is what they do at the counter anyway.
   */
  eligibility?: string[];

  /** DOCUMENT_GROUP: which requirement group defines satisfaction. */
  requirementGroupId?: string;

  /** ELIGIBILITY: the rule the citizen must satisfy. */
  rule?: Condition;

  /**
   * Someone other than the citizen must act before this can complete. Drives
   * the WAITING_EXTERNAL state and the "reapplying will not help" message.
   */
  blockedBy?: Actor;

  /** DOCUMENT: true when the citizen simply owns it, no service produces it. */
  selfProvided?: boolean;
}

export interface GraphNode {
  /** Canonical key, namespaced by type: "service:driving_licence". */
  id: string;
  type: NodeType;
  /** Plain language, what a citizen would call it. */
  name: string;
  /** Government terminology, preserved verbatim where it differs. */
  officialName?: string;
  aliases?: string[];
  description?: string;
  /** Where this node itself lives. Undefined means national / universal. */
  jurisdictionId?: string;
  metadata?: NodeMetadata;
  sources?: SourceRef[];
  lastVerifiedAt?: string;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type EdgeType =
  | "REQUIRES"
  | "DEPENDS_ON"
  | "PRODUCES"
  | "NEXT"
  | "APPLY_AT"
  | "AVAILABLE_VIA"
  | "VISIT_AT"
  | "HANDLED_BY"
  | "ISSUED_BY"
  | "VERIFIED_BY"
  | "TRACK_AT"
  | "CALL_IF"
  | "ESCALATE_TO"
  | "BLOCKS"
  | "SATISFIES"
  | "ALTERNATIVE_TO";

export type VerificationStatus =
  | "DISCOVERED"
  | "EXTRACTED"
  | "NORMALIZED"
  | "VERIFIED"
  | "CONFLICTING"
  | "STALE"
  | "REJECTED";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  /** Applies only when this evaluates true. Undefined means always. */
  condition?: Condition;
  /** Scope. Undefined means it applies everywhere below the root. */
  jurisdictionId?: string;
  /** Citizen-facing reason this relationship exists. */
  note?: string;
  validFrom?: string;
  validUntil?: string;
  verificationStatus: VerificationStatus;
  sources?: SourceRef[];
}

// ---------------------------------------------------------------------------
// Requirement groups (AND / OR / N-of)
// ---------------------------------------------------------------------------

export type RequirementMode = "ALL_OF" | "ANY_OF" | "AT_LEAST_N";

export interface RequirementGroupMember {
  nodeId: string;
  /** This alternative is only accepted when the condition holds. */
  condition?: Condition;
  note?: string;
}

export interface RequirementGroup {
  id: string;
  ownerNodeId: string;
  mode: RequirementMode;
  /** Only meaningful for AT_LEAST_N. */
  minimumRequired?: number;
  condition?: Condition;
  jurisdictionId?: string;
  members: RequirementGroupMember[];
  sources?: SourceRef[];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type SourceType =
  | "SERVICE_PAGE"
  | "GUIDELINE"
  | "FAQ"
  | "OFFICE_DIRECTORY"
  | "HELPLINE"
  | "MOBILE_APP_INFO"
  | "TRACKING_PAGE"
  | "GRIEVANCE_PAGE"
  | "PDF"
  | "PORTAL_HOME";

export interface Source {
  id: string;
  url: string;
  title: string;
  domain: string;
  sourceType: SourceType;
  jurisdictionId?: string;
  retrievedAt: string;
  contentHash?: string;
  /**
   * False when the page was served over a certificate chain we could not
   * verify. Several real Gujarat portals are in this state, including
   * digitalgujarat.gov.in, which is the largest citizen service portal in the
   * state and cannot simply be dropped.
   *
   * So we fetch them and say so. A quote from such a page is still a quote from
   * that page, but nothing proved the host was who it claimed to be, and a
   * citizen deserves to know which of those two things they are looking at.
   * Absent means the ordinary case: the chain verified.
   */
  tlsVerified?: boolean;
}

/** A pointer from a graph fact back to the page that justifies it. */
export interface SourceRef {
  sourceId: string;
  /** Copied verbatim from the page. This is what makes the claim checkable. */
  evidence?: string;
  confidence?: number;
  verificationStatus?: VerificationStatus;
}

/** A SourceRef with its Source inlined, ready to render. */
export interface ResolvedSource extends SourceRef {
  source: Source;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type ConditionOperator =
  | "EQ"
  | "NEQ"
  | "IN"
  | "NOT_IN"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "EXISTS"
  | "NOT_EXISTS";

export interface Predicate {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export type Condition =
  | Predicate
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/**
 * Three-valued on purpose. UNKNOWN is not a failure, it is the signal that we
 * still need to ask the citizen something, and it is where the question flow
 * comes from.
 */
export type Truth = "TRUE" | "FALSE" | "UNKNOWN";

/** Flat bag of everything we know about the citizen, keyed by field name. */
export type Facts = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Citizen input
// ---------------------------------------------------------------------------

export interface CitizenContext {
  /** Canonical document keys the citizen already holds, e.g. "document:aadhaar". */
  documents?: string[];
  /** Canonical service keys already completed, e.g. "service:learner_licence". */
  completedServices?: string[];
  /** Answers to derived questions, keyed by question field id. */
  answers?: Facts;
}

export interface CompileRequest {
  /** Canonical goal key, with or without the "service:" prefix. */
  goal: string;
  jurisdiction: JurisdictionQuery;
  citizen?: CitizenContext;
}

// ---------------------------------------------------------------------------
// Journey output
// ---------------------------------------------------------------------------

export type NodeState =
  | "SATISFIED"
  | "READY"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "WAITING_EXTERNAL"
  | "COMPLETED"
  | "SKIPPED";

export interface DocumentRequirement {
  nodeId: string;
  name: string;
  officialName?: string;
  /** True when the citizen told us they already hold it. */
  held: boolean;
  /** ANY_OF alternatives, when this is a document group. */
  alternatives?: DocumentRequirement[];
  mode?: RequirementMode;
  minimumRequired?: number;
  /** The service that issues this document, when one exists in the graph. */
  producedByServiceId?: string;
  note?: string;
  sources: ResolvedSource[];
}

export interface Channel {
  nodeId: string;
  name: string;
  officialName?: string;
  channelType: ChannelType;
  url?: string;
  androidAppId?: string;
  iosAppId?: string;
  /** HELPLINE and GRIEVANCE_CHANNEL. A phone channel with no number is furniture. */
  phoneNumbers?: string[];
  emails?: string[];
  workingHours?: string;
  /** APPLY_AT, TRACK_AT, AVAILABLE_VIA, ESCALATE_TO ... */
  via: EdgeType;
  note?: string;
  sources: ResolvedSource[];
}

export interface OfficeRef {
  nodeId: string;
  name: string;
  officeType?: string;
  address?: string;
  phoneNumbers?: string[];
  workingHours?: string;
  latitude?: number;
  longitude?: number;
  jurisdictionId?: string;
  via: EdgeType;
  sources: ResolvedSource[];
}

/**
 * Government pages print the office name inside the address more often than
 * not, so naive `name + address` renders "Mamlatdar Office, Ahmedabad
 * Mamlatdar Office, Ahmedabad - 380027". Addresses are quoted verbatim and are
 * not going to be tidied up, so the fix lives here where every renderer shares
 * it.
 */
export function officeLine(office: OfficeRef): string {
  if (!office.address) return `${office.name} (address not verified yet)`;
  return office.address.includes(office.name) ? office.address : `${office.name}, ${office.address}`;
}

export interface Blocker {
  nodeId: string;
  title: string;
  reason: string;
  /** Who has to move. CITIZEN blockers are actionable, others are not. */
  actor: Actor;
  /** What the citizen can actually do about it, including escalation. */
  resolution?: string;
  escalation: Channel[];
  sources: ResolvedSource[];
}

export interface JourneyStep {
  order: number;
  nodeId: string;
  type: NodeType;
  title: string;
  officialName?: string;
  state: NodeState;
  /**
   * What this step is, in the node's own words.
   *
   * 216 of 217 services carry a description and none of it reached a screen,
   * which mattered most for the generated ones: they have no `whatToDo`, so a
   * machine written service arrived as a bare title with a fee under it.
   */
  description?: string;
  whyRequired?: string;
  whatToDo?: string;
  expectedOutput?: string;
  fee?: string;
  timeline?: string;
  formNumber?: string;
  /** Who qualifies, quoted from the page. See `NodeMetadata.eligibility`. */
  eligibility?: string[];
  /**
   * Nobody has read this page. A machine found it, quoted it and checked the
   * quote, and that is a different thing from a person having looked.
   *
   * 189 of 217 services are this. The label was written onto the node by the
   * compiler and stopped at the database, so the citizen saw a machine's
   * reading and a researcher's reading in the same typeface, which is the one
   * thing this project is not allowed to let happen.
   */
  machineExtracted?: boolean;
  documentsNeeded: DocumentRequirement[];
  documentsReady: DocumentRequirement[];
  channels: Channel[];
  offices: OfficeRef[];
  helplines: Channel[];
  escalation: Channel[];
  blockers: Blocker[];
  /** Node ids that must happen before this step. */
  dependsOn: string[];
  produces: string[];
  sources: ResolvedSource[];
  lastVerifiedAt?: string;
}

export interface JourneySummary {
  documentsReadyCount: number;
  documentsToPrepareCount: number;
  stepsRemaining: number;
  physicalVisits: number;
  digitalChannels: number;
  blockerCount: number;
}

/** A question the graph decided is worth asking, because it changes the graph. */
export interface DerivedQuestion {
  field: string;
  label: string;
  help?: string;
  inputType: "NUMBER" | "TEXT" | "SINGLE_SELECT" | "MULTI_SELECT" | "BOOLEAN";
  options?: { value: string; label: string }[];
  /** Node ids whose inclusion depends on this answer. Used to explain the ask. */
  affects: string[];
}

/** One line of the "how we figured this out" trace. */
export interface TraceEntry {
  stage: string;
  detail: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface CompiledJourney {
  goal: string;
  goalName: string;
  jurisdiction: { resolvedId: string; chain: string[]; name: string };
  summary: JourneySummary;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  nodeStates: Record<string, NodeState>;
  orderedSteps: JourneyStep[];
  documentsReady: DocumentRequirement[];
  documentsNeeded: DocumentRequirement[];
  prerequisiteServices: string[];
  digitalChannels: Channel[];
  mobileApps: Channel[];
  offices: OfficeRef[];
  helplines: Channel[];
  blockers: Blocker[];
  escalationPaths: Channel[];
  outstandingQuestions: DerivedQuestion[];
  sources: ResolvedSource[];
  trace: TraceEntry[];
  /** Cycles found in the source data. Should be empty, logged loudly if not. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// The dataset
// ---------------------------------------------------------------------------

export interface GraphData {
  jurisdictions: Jurisdiction[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  requirementGroups: RequirementGroup[];
  sources: Source[];
  questions: QuestionDefinition[];
}

/** Static catalogue of how to ask for each condition field. */
export interface QuestionDefinition {
  field: string;
  label: string;
  help?: string;
  inputType: DerivedQuestion["inputType"];
  options?: { value: string; label: string }[];
}
