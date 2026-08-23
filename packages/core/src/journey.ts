import { evaluateCondition, unresolvedFields } from "./condition.js";
import { extractSubgraph, filterEdges, GraphIndex, topologicalSort, traverse } from "./graph.js";
import { JurisdictionIndex, type ResolvedJurisdiction } from "./jurisdiction.js";
import { evaluateRequirementGroup, type GroupContext } from "./requirements.js";
import type {
  Blocker,
  Channel,
  ChannelType,
  CompiledJourney,
  CompileRequest,
  DerivedQuestion,
  DocumentRequirement,
  EdgeType,
  Facts,
  GraphData,
  GraphEdge,
  GraphNode,
  JourneyStep,
  NodeState,
  NodeType,
  OfficeRef,
  QuestionDefinition,
  TraceEntry,
} from "./types.js";

/**
 * The journey compiler.
 *
 * Everything here is deterministic. No model is called, nothing is inferred
 * that is not in the graph. An LLM may have decided which goal the citizen
 * meant, but from this point on the graph decides what that actually requires,
 * in what order, through which channel, and what is blocking it.
 */

/** Walked outward from the goal. These define "what has to happen first". */
const DEPENDENCY_EDGES: readonly EdgeType[] = ["REQUIRES", "DEPENDS_ON", "NEXT", "BLOCKS"];

/** Walked backward from an unmet document to whatever service issues it. */
const PRODUCER_EDGES: readonly EdgeType[] = ["PRODUCES"];

/** Pulled one hop off a retained step. Never expanded through. */
const ATTACHMENT_EDGES: readonly EdgeType[] = [
  "PRODUCES",
  "APPLY_AT",
  "AVAILABLE_VIA",
  "TRACK_AT",
  "VISIT_AT",
  "HANDLED_BY",
  "ISSUED_BY",
  "VERIFIED_BY",
  "CALL_IF",
  "ESCALATE_TO",
  "ALTERNATIVE_TO",
];

/** Node types that become a numbered thing the citizen has to do. */
const STEP_TYPES: readonly NodeType[] = ["SERVICE", "ACTION", "VERIFICATION", "PAYMENT"];

/** Node types that can be "obtained" and therefore satisfied by possession. */
const HOLDABLE_TYPES: readonly NodeType[] = ["DOCUMENT", "DOCUMENT_GROUP", "SERVICE", "OUTPUT"];

export class GoalNotFoundError extends Error {
  constructor(readonly goal: string) {
    super(`No service in the graph matches goal "${goal}"`);
    this.name = "GoalNotFoundError";
  }
}

export class JurisdictionNotFoundError extends Error {
  constructor(readonly query: unknown) {
    super(`Could not resolve jurisdiction from ${JSON.stringify(query)}`);
    this.name = "JurisdictionNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export class JourneyCompiler {
  private readonly index: GraphIndex;
  private readonly jurisdictions: JurisdictionIndex;
  private readonly questions: Map<string, QuestionDefinition>;

  constructor(private readonly data: GraphData) {
    this.index = new GraphIndex(data);
    this.jurisdictions = new JurisdictionIndex(data.jurisdictions);
    this.questions = new Map(data.questions.map((q) => [q.field, q]));
  }

  get graph(): GraphIndex {
    return this.index;
  }

  get jurisdictionIndex(): JurisdictionIndex {
    return this.jurisdictions;
  }

  /** Free text is not accepted here. Resolve to a canonical key first. */
  resolveGoal(goal: string): GraphNode | undefined {
    const raw = goal.trim().toLowerCase();
    const candidates = [raw, `service:${raw}`, raw.replace(/[\s-]+/g, "_"), `service:${raw.replace(/[\s-]+/g, "_")}`];
    for (const key of candidates) {
      const hit = this.index.node(key);
      if (hit) return hit;
    }
    for (const node of this.index.nodes.values()) {
      if (node.type !== "SERVICE") continue;
      if (node.name.toLowerCase() === raw) return node;
      if (node.aliases?.some((a) => a.toLowerCase() === raw)) return node;
    }
    return undefined;
  }

  compile(request: CompileRequest): CompiledJourney {
    const trace: TraceEntry[] = [];
    const warnings: string[] = [];

    const root = this.resolveGoal(request.goal);
    if (!root) throw new GoalNotFoundError(request.goal);
    trace.push({ stage: "Resolve goal", detail: `"${request.goal}" resolved to ${root.name}`, nodeIds: [root.id] });

    const jurisdiction = this.jurisdictions.resolve(request.jurisdiction);
    if (!jurisdiction) throw new JurisdictionNotFoundError(request.jurisdiction);
    trace.push({
      stage: "Resolve jurisdiction",
      detail: `${jurisdiction.name}, applying rules scoped to ${jurisdiction.chain.join(" then ")}`,
    });

    const held = this.buildHeldSet(request, jurisdiction.chain);
    const facts = this.buildFacts(request, jurisdiction, held);
    trace.push({
      stage: "Apply citizen answers",
      detail: `${held.size} things already held, ${Object.keys(request.citizen?.answers ?? {}).length} questions answered`,
    });

    // Definitive pass: only what this citizen certainly needs.
    const expansion = this.expand(root.id, { held, facts, chain: jurisdiction.chain, keepUnknown: false });
    warnings.push(...expansion.cycles.map((c) => `Dependency cycle in source data: ${c.join(" -> ")}`));
    trace.push({
      stage: "Expand dependencies",
      detail: `${expansion.nodeIds.size} nodes reachable from the goal`,
      nodeIds: [...expansion.nodeIds],
    });

    // Optimistic pass: what we would need if every unanswered question went the
    // other way. The difference between the two is exactly what is worth asking.
    const optimistic = this.expand(root.id, { held, facts, chain: jurisdiction.chain, keepUnknown: true });
    const outstandingQuestions = this.deriveQuestions(optimistic, facts);
    if (outstandingQuestions.length) {
      trace.push({
        stage: "Derive questions",
        detail: `${outstandingQuestions.length} unanswered field(s) still change the graph: ${outstandingQuestions
          .map((q) => q.field)
          .join(", ")}`,
      });
    }

    const attachments = this.attach(expansion, { facts, chain: jurisdiction.chain });
    const allNodeIds = new Set([...expansion.nodeIds, ...attachments.nodeIds]);
    const allEdges = dedupeBy([...expansion.edges, ...attachments.edges], (e) => e.id);
    trace.push({
      stage: "Attach channels and offices",
      detail: `${attachments.nodeIds.size} portals, apps, offices, helplines and escalation routes attached`,
    });

    const nodeStates = this.computeStates(allNodeIds, held, facts);
    const satisfiedCount = [...allNodeIds].filter((id) => nodeStates[id] === "SATISFIED").length;
    trace.push({ stage: "Mark satisfied nodes", detail: `${satisfiedCount} requirement(s) already met, pruned from the path` });

    const ordering = this.order(allNodeIds, allEdges);
    if (ordering.unordered.length) {
      warnings.push(`Could not order: ${ordering.unordered.join(", ")}`);
    }
    trace.push({ stage: "Topological ordering", detail: `${ordering.order.length} nodes sequenced`, nodeIds: ordering.order });

    const ctx: BuildContext = {
      held,
      facts,
      chain: jurisdiction.chain,
      nodeStates,
      edges: allEdges,
      nodeIds: allNodeIds,
    };

    const steps = this.buildSteps(ordering.order, ctx);
    const subgraph = extractSubgraph(this.index, allNodeIds, allEdges);

    const blockers = steps.flatMap((s) => s.blockers);
    trace.push({
      stage: "Detect blockers",
      detail: blockers.length ? blockers.map((b) => b.title).join(", ") : "nothing blocking",
    });

    const documentsNeeded = dedupeBy(steps.flatMap((s) => s.documentsNeeded), (d) => d.nodeId);
    const documentsReady = dedupeBy(steps.flatMap((s) => s.documentsReady), (d) => d.nodeId);
    const allChannels = dedupeBy(steps.flatMap((s) => s.channels), (c) => `${c.nodeId}|${c.via}`);
    const offices = dedupeBy(steps.flatMap((s) => s.offices), (o) => o.nodeId);
    const helplines = dedupeBy(steps.flatMap((s) => s.helplines), (c) => c.nodeId);
    const escalationPaths = dedupeBy(steps.flatMap((s) => s.escalation), (c) => c.nodeId);

    const mobileApps = allChannels.filter((c) => c.channelType === "ANDROID_APP" || c.channelType === "IOS_APP");
    const digitalChannels = allChannels.filter((c) => c.channelType === "WEB" || c.channelType === "GRIEVANCE_PORTAL");

    const remaining = steps.filter((s) => s.state !== "SATISFIED" && s.state !== "COMPLETED");

    return {
      goal: root.id,
      goalName: root.name,
      jurisdiction: { resolvedId: jurisdiction.id, chain: jurisdiction.chain, name: jurisdiction.name },
      summary: {
        documentsReadyCount: documentsReady.length,
        documentsToPrepareCount: documentsNeeded.length,
        stepsRemaining: remaining.length,
        physicalVisits: offices.filter((o) => o.via === "VISIT_AT").length,
        digitalChannels: dedupeBy(digitalChannels, (c) => c.nodeId).length,
        blockerCount: blockers.length,
      },
      graph: subgraph,
      nodeStates,
      orderedSteps: steps,
      documentsReady,
      documentsNeeded,
      prerequisiteServices: steps.filter((s) => s.type === "SERVICE" && s.nodeId !== root.id).map((s) => s.nodeId),
      digitalChannels,
      mobileApps,
      offices,
      helplines,
      blockers,
      escalationPaths,
      outstandingQuestions,
      sources: dedupeBy(
        [...steps.flatMap((s) => s.sources), ...steps.flatMap((s) => s.documentsNeeded.flatMap((d) => d.sources))],
        (s) => `${s.sourceId}|${s.evidence ?? ""}`,
      ),
      trace,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Citizen state
  // -------------------------------------------------------------------------

  /**
   * What the citizen already has, closed over requirement groups. Holding an
   * Aadhaar means holding "address proof" if Aadhaar is an accepted
   * alternative, and the citizen should never be asked for it twice.
   */
  private buildHeldSet(request: CompileRequest, chain: string[]): Set<string> {
    const held = new Set<string>();
    for (const raw of request.citizen?.documents ?? []) {
      const id = this.canonicalise(raw, ["DOCUMENT", "DOCUMENT_GROUP", "OUTPUT"]);
      if (id) held.add(id);
    }
    for (const raw of request.citizen?.completedServices ?? []) {
      const id = this.canonicalise(raw, ["SERVICE"]);
      if (id) held.add(id);
    }

    // Groups can nest, so close over them until nothing new is satisfied.
    // Bounded by group count, which is small and never citizen controlled.
    const groupCtx: GroupContext = {
      held,
      facts: { ...(request.citizen?.answers ?? {}) },
      chain,
      groupsFor: (id) => this.index.groupsOwnedBy(id),
    };
    for (let pass = 0; pass < this.data.requirementGroups.length + 1; pass++) {
      let grew = false;
      for (const group of this.data.requirementGroups) {
        if (held.has(group.ownerNodeId)) continue;
        if (evaluateRequirementGroup(group, groupCtx).satisfied === "TRUE") {
          held.add(group.ownerNodeId);
          grew = true;
        }
      }
      if (!grew) break;
    }

    return held;
  }

  /** Accept "aadhaar", "document:aadhaar" or the display name. */
  private canonicalise(raw: string, types: readonly NodeType[]): string | undefined {
    const key = raw.trim().toLowerCase();
    if (this.index.node(key)) return key;
    for (const type of types) {
      const prefixed = `${type.toLowerCase()}:${key.replace(/[\s-]+/g, "_")}`;
      if (this.index.node(prefixed)) return prefixed;
    }
    for (const node of this.index.nodes.values()) {
      if (!types.includes(node.type)) continue;
      if (node.name.toLowerCase() === key || node.aliases?.some((a) => a.toLowerCase() === key)) return node.id;
    }
    return undefined;
  }

  /**
   * The fact bag conditions are evaluated against. Possession is written in as
   * present-or-absent keys, which is why EXISTS is always decidable and
   * document questions never end up in the question flow.
   */
  private buildFacts(request: CompileRequest, jurisdiction: ResolvedJurisdiction, held: Set<string>): Facts {
    const facts: Facts = {
      ...(request.citizen?.answers ?? {}),
      country: request.jurisdiction.country,
      state: request.jurisdiction.state,
      district: request.jurisdiction.district,
      jurisdiction: jurisdiction.id,
    };
    for (const id of held) facts[id] = true;
    for (const key of Object.keys(facts)) if (facts[key] === undefined) delete facts[key];
    return facts;
  }

  // -------------------------------------------------------------------------
  // Expansion
  // -------------------------------------------------------------------------

  private expand(rootId: string, opts: ExpandOptions): Expansion {
    const syntheticEdges = new Map<string, GraphEdge>();
    /** field -> node ids whose inclusion is still undecided because of it. */
    const pendingFields = new Map<string, Set<string>>();

    const filter = { chain: opts.chain, facts: opts.facts, keepUnknown: opts.keepUnknown };

    const expandFrom = (nodeId: string): GraphEdge[] => {
      const node = this.index.node(nodeId);
      if (!node) return [];

      // Satisfaction pruning. If the citizen already holds it, we do not care
      // how it is obtained, and neither do they.
      if (opts.held.has(nodeId)) return [];

      const out: GraphEdge[] = [];

      for (const hit of filterEdges(this.index.outgoing(nodeId, DEPENDENCY_EDGES), { ...filter, keepUnknown: true })) {
        if (hit.truth === "UNKNOWN") {
          this.recordPending(pendingFields, hit.edge.condition, hit.edge.to, opts.facts);
          if (!opts.keepUnknown) continue;
        }
        out.push(hit.edge);
      }

      // Requirement group members become real edges for traversal and for the
      // graph view. The ANY_OF semantics live on the group, not on the edge,
      // and are reapplied when the document list is built.
      for (const group of this.index.groupsOwnedBy(nodeId)) {
        const evaluation = evaluateRequirementGroup(group, {
          held: opts.held,
          facts: opts.facts,
          chain: opts.chain,
          groupsFor: (id) => this.index.groupsOwnedBy(id),
        });
        if (evaluation.satisfied === "TRUE") continue;

        for (const member of group.members) {
          const truth = evaluateCondition(member.condition, opts.facts);
          if (truth === "FALSE") continue;
          if (truth === "UNKNOWN") {
            this.recordPending(pendingFields, member.condition, member.nodeId, opts.facts);
            if (!opts.keepUnknown) continue;
          }
          const edge = synthesiseMemberEdge(group, member);
          syntheticEdges.set(edge.id, edge);
          out.push(edge);
        }
      }

      // An unmet document is only actionable if something issues it. Walk the
      // PRODUCES edge backward to find the service that does.
      if (HOLDABLE_TYPES.includes(node.type) && node.type !== "SERVICE") {
        for (const hit of filterEdges(this.index.incoming(nodeId, PRODUCER_EDGES), filter)) out.push(hit.edge);
      }

      return out;
    };

    const result = traverse([rootId], expandFrom);
    return {
      nodeIds: new Set(result.visited),
      edges: result.edges,
      cycles: result.cycles,
      syntheticEdges,
      pendingFields,
    };
  }

  private recordPending(
    into: Map<string, Set<string>>,
    condition: Parameters<typeof unresolvedFields>[0],
    nodeId: string,
    facts: Facts,
  ): void {
    for (const field of unresolvedFields(condition, facts)) {
      const bucket = into.get(field);
      if (bucket) bucket.add(nodeId);
      else into.set(field, new Set([nodeId]));
    }
  }

  /** One hop off each retained step, for channels, offices and escalation. */
  private attach(expansion: Expansion, opts: { facts: Facts; chain: string[] }): { nodeIds: Set<string>; edges: GraphEdge[] } {
    const nodeIds = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const id of expansion.nodeIds) {
      const node = this.index.node(id);
      if (!node) continue;
      for (const hit of filterEdges(this.index.outgoing(id, ATTACHMENT_EDGES), { ...opts, keepUnknown: false })) {
        edges.push(hit.edge);
        if (!expansion.nodeIds.has(hit.edge.to)) nodeIds.add(hit.edge.to);
      }
    }
    return { nodeIds, edges };
  }

  // -------------------------------------------------------------------------
  // States, ordering, steps
  // -------------------------------------------------------------------------

  private computeStates(nodeIds: Set<string>, held: Set<string>, facts: Facts): Record<string, NodeState> {
    const states: Record<string, NodeState> = {};

    for (const id of nodeIds) {
      const node = this.index.node(id);
      if (!node) continue;

      if (held.has(id)) {
        states[id] = "SATISFIED";
        continue;
      }

      if (node.type === "ELIGIBILITY") {
        const truth = evaluateCondition(node.metadata?.rule, facts);
        states[id] = truth === "TRUE" ? "SATISFIED" : truth === "FALSE" ? "BLOCKED" : "READY";
        continue;
      }

      // Someone other than the citizen has to move first. Rendering this as
      // READY is what makes people reapply five times and get rejected five
      // times, so it gets its own state.
      const actor = node.metadata?.blockedBy;
      states[id] = actor && actor !== "CITIZEN" ? "WAITING_EXTERNAL" : "READY";
    }
    return states;
  }

  /** Dependency direction per edge type, expressed as [before, after]. */
  private order(nodeIds: Set<string>, edges: GraphEdge[]): { order: string[]; unordered: string[] } {
    const pairs: [string, string][] = [];
    for (const edge of edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
      switch (edge.type) {
        case "REQUIRES":
        case "DEPENDS_ON":
          pairs.push([edge.to, edge.from]); // the dependency comes first
          break;
        case "PRODUCES":
        case "NEXT":
        case "BLOCKS":
          pairs.push([edge.from, edge.to]);
          break;
        default:
          break; // attachments do not constrain order
      }
    }
    // Reverse discovery order, so among steps that are equally unblocked the
    // one furthest from the goal is offered first. Without this the goal's own
    // direct requirements surface before the prerequisite service's ones, and
    // the citizen is told to pay the driving test fee before applying for the
    // learner's licence.
    return topologicalSort([...nodeIds].reverse(), pairs);
  }

  private buildSteps(order: string[], ctx: BuildContext): JourneyStep[] {
    const steps: JourneyStep[] = [];
    let counter = 0;

    for (const id of order) {
      const node = this.index.node(id);
      if (!node || !STEP_TYPES.includes(node.type)) continue;

      const outgoing = ctx.edges.filter((e) => e.from === id);
      const documents = this.buildDocumentRequirements(id, outgoing, ctx);

      const channels = this.channelsFor(outgoing, ["APPLY_AT", "AVAILABLE_VIA", "TRACK_AT"], ctx);
      const helplines = this.channelsFor(outgoing, ["CALL_IF"], ctx);
      const escalation = this.channelsFor(outgoing, ["ESCALATE_TO"], ctx);
      const offices = this.officesFor(outgoing, ctx);

      steps.push({
        order: ++counter,
        nodeId: id,
        type: node.type,
        title: node.name,
        officialName: node.officialName,
        state: ctx.nodeStates[id] ?? "READY",
        whyRequired: node.metadata?.whyRequired,
        whatToDo: node.metadata?.whatToDo,
        expectedOutput: node.metadata?.expectedOutput,
        fee: node.metadata?.fee,
        timeline: node.metadata?.timeline,
        formNumber: node.metadata?.formNumber,
        documentsNeeded: documents.needed,
        documentsReady: documents.ready,
        channels,
        offices,
        helplines,
        escalation,
        blockers: this.blockersFor(node, outgoing, ctx, escalation),
        dependsOn: outgoing.filter((e) => e.type === "REQUIRES" || e.type === "DEPENDS_ON").map((e) => e.to),
        produces: outgoing.filter((e) => e.type === "PRODUCES").map((e) => e.to),
        sources: this.index.resolveSources(node.sources),
        lastVerifiedAt: node.lastVerifiedAt,
      });
    }
    return steps;
  }

  private buildDocumentRequirements(
    ownerId: string,
    outgoing: GraphEdge[],
    ctx: BuildContext,
  ): { needed: DocumentRequirement[]; ready: DocumentRequirement[] } {
    const needed: DocumentRequirement[] = [];
    const ready: DocumentRequirement[] = [];
    // Two edges can demand the same document, most often when sources conflict.
    // The citizen should see it once.
    const seen = new Set<string>();
    const file = (r: DocumentRequirement) => {
      if (seen.has(r.nodeId)) return;
      seen.add(r.nodeId);
      (r.held ? ready : needed).push(r);
    };

    // Requirement groups hung directly off this step. The synthetic rg: edges
    // are skipped below because the group carries the AND / OR rule and an
    // edge on its own cannot.
    for (const group of this.index.groupsOwnedBy(ownerId)) {
      const evaluation = evaluateRequirementGroup(group, this.groupContext(ctx));
      for (const member of group.members) {
        if (evaluation.inapplicableMembers.includes(member.nodeId)) continue;
        const node = this.index.node(member.nodeId);
        if (!node) continue;
        file({
          ...this.describeRequirement(node, undefined, ctx),
          mode: group.mode,
          minimumRequired: evaluation.minimumRequired,
          note: member.note,
          held: ctx.held.has(node.id) || evaluation.satisfied === "TRUE",
        });
      }
    }

    for (const edge of outgoing) {
      if (edge.type !== "REQUIRES" || edge.id.startsWith("rg:")) continue;
      const target = this.index.node(edge.to);
      if (!isDocumentish(target) || !target) continue;
      file(this.describeRequirement(target, edge, ctx));
    }

    return { needed, ready };
  }

  private groupContext(ctx: BuildContext): GroupContext {
    return {
      held: ctx.held,
      facts: ctx.facts,
      chain: ctx.chain,
      groupsFor: (id) => this.index.groupsOwnedBy(id),
    };
  }

  private describeRequirement(node: GraphNode, edge: GraphEdge | undefined, ctx: BuildContext): DocumentRequirement {
    const held = ctx.held.has(node.id);
    const producer = this.index
      .incoming(node.id, PRODUCER_EDGES)
      .find((e) => ctx.nodeIds.has(e.from));

    const base: DocumentRequirement = {
      nodeId: node.id,
      name: node.name,
      officialName: node.officialName,
      held,
      producedByServiceId: producer?.from,
      note: edge?.note,
      sources: this.index.resolveSources(edge?.sources ?? node.sources),
    };

    // A document group renders as its accepted alternatives, with the AND/OR
    // rule attached, so the citizen sees "any one of these" and not a list of
    // six mandatory documents.
    const group = this.index.groupsOwnedBy(node.id)[0];
    if (!group) return base;

    const evaluation = evaluateRequirementGroup(group, this.groupContext(ctx));

    const alternatives: DocumentRequirement[] = [];
    for (const member of group.members) {
      if (evaluation.inapplicableMembers.includes(member.nodeId)) continue;
      const memberNode = this.index.node(member.nodeId);
      if (!memberNode) continue;
      alternatives.push({
        nodeId: memberNode.id,
        name: memberNode.name,
        officialName: memberNode.officialName,
        held: ctx.held.has(memberNode.id),
        note: member.note,
        sources: this.index.resolveSources(memberNode.sources),
      });
    }

    return {
      ...base,
      held: held || evaluation.satisfied === "TRUE",
      mode: group.mode,
      minimumRequired: evaluation.minimumRequired,
      alternatives,
      sources: base.sources.length ? base.sources : this.index.resolveSources(group.sources),
    };
  }

  private channelsFor(outgoing: GraphEdge[], types: readonly EdgeType[], ctx: BuildContext): Channel[] {
    const channels: Channel[] = [];
    for (const edge of outgoing) {
      if (!types.includes(edge.type)) continue;
      const node = this.index.node(edge.to);
      if (!node || node.type === "OFFICE") continue;
      channels.push({
        nodeId: node.id,
        name: node.name,
        officialName: node.officialName,
        channelType: inferChannelType(node),
        url: node.metadata?.url,
        androidAppId: node.metadata?.androidAppId,
        iosAppId: node.metadata?.iosAppId,
        via: edge.type,
        note: edge.note,
        sources: this.index.resolveSources(edge.sources ?? node.sources),
      });
    }
    void ctx;
    return channels;
  }

  private officesFor(outgoing: GraphEdge[], ctx: BuildContext): OfficeRef[] {
    const offices: OfficeRef[] = [];
    for (const edge of outgoing) {
      if (edge.type !== "VISIT_AT" && edge.type !== "HANDLED_BY" && edge.type !== "ESCALATE_TO") continue;
      const node = this.index.node(edge.to);
      if (!node || node.type !== "OFFICE") continue;
      offices.push({
        nodeId: node.id,
        name: node.name,
        officeType: node.metadata?.officeType,
        address: node.metadata?.address,
        phoneNumbers: node.metadata?.phoneNumbers,
        workingHours: node.metadata?.workingHours,
        latitude: node.metadata?.latitude,
        longitude: node.metadata?.longitude,
        jurisdictionId: node.jurisdictionId,
        via: edge.type,
        sources: this.index.resolveSources(node.sources),
      });
    }
    void ctx;
    return offices;
  }

  /**
   * Blockers surface on the step that is held up, not on the node that is
   * failing. An eligibility rule and a document waiting on someone else are
   * never steps of their own, so if they only reported themselves nobody would
   * ever see them.
   */
  private blockersFor(node: GraphNode, outgoing: GraphEdge[], ctx: BuildContext, escalation: Channel[]): Blocker[] {
    const blockers: Blocker[] = [];
    const seen = new Set<string>();

    const add = (id: string, edge?: GraphEdge) => {
      if (seen.has(id)) return;
      const source = this.index.node(id);
      if (!source) return;
      const state = ctx.nodeStates[id];
      if (state !== "BLOCKED" && state !== "WAITING_EXTERNAL") return;
      seen.add(id);

      const actor = source.metadata?.blockedBy ?? "CITIZEN";
      blockers.push({
        nodeId: id,
        title: source.name,
        reason:
          edge?.note ??
          source.description ??
          (state === "WAITING_EXTERNAL"
            ? `This cannot move until the ${actor.toLowerCase()} acts. Applying again will not change that.`
            : "You do not currently meet this requirement."),
        actor,
        resolution: source.metadata?.whatToDo,
        escalation,
        sources: this.index.resolveSources(edge?.sources ?? source.sources),
      });
    };

    add(node.id);
    for (const edge of outgoing) {
      if (edge.type === "REQUIRES" || edge.type === "DEPENDS_ON") add(edge.to, edge);
    }
    // Something upstream explicitly BLOCKS this node.
    for (const edge of ctx.edges) {
      if (edge.type === "BLOCKS" && edge.to === node.id) add(edge.from, edge);
    }

    return blockers;
  }

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------

  /**
   * A question is only worth asking if the answer changes the graph. The
   * optimistic expansion already recorded every field that left a branch
   * undecided, so the question list is a projection of the graph and never a
   * hand maintained form.
   */
  private deriveQuestions(expansion: Expansion, facts: Facts): DerivedQuestion[] {
    const questions: DerivedQuestion[] = [];

    for (const [field, affected] of expansion.pendingFields) {
      if (facts[field] !== undefined) continue;
      const definition = this.questions.get(field);
      questions.push({
        field,
        label: definition?.label ?? humanise(field),
        help: definition?.help,
        inputType: definition?.inputType ?? "TEXT",
        options: definition?.options,
        affects: [...affected],
      });
    }

    // Eligibility rules can gate a node without gating an edge.
    for (const id of expansion.nodeIds) {
      const node = this.index.node(id);
      if (node?.type !== "ELIGIBILITY") continue;
      for (const field of unresolvedFields(node.metadata?.rule, facts)) {
        if (questions.some((q) => q.field === field)) continue;
        const definition = this.questions.get(field);
        questions.push({
          field,
          label: definition?.label ?? humanise(field),
          help: definition?.help,
          inputType: definition?.inputType ?? "TEXT",
          options: definition?.options,
          affects: [id],
        });
      }
    }

    // Stable order, most consequential first.
    questions.sort((a, b) => b.affects.length - a.affects.length || a.field.localeCompare(b.field));
    return questions;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExpandOptions {
  held: Set<string>;
  facts: Facts;
  chain: string[];
  keepUnknown: boolean;
}

interface Expansion {
  nodeIds: Set<string>;
  edges: GraphEdge[];
  cycles: string[][];
  syntheticEdges: Map<string, GraphEdge>;
  pendingFields: Map<string, Set<string>>;
}

interface BuildContext {
  held: Set<string>;
  facts: Facts;
  chain: string[];
  nodeStates: Record<string, NodeState>;
  edges: GraphEdge[];
  nodeIds: Set<string>;
}

function synthesiseMemberEdge(
  group: { id: string; ownerNodeId: string; jurisdictionId?: string; sources?: GraphEdge["sources"] },
  member: { nodeId: string; condition?: GraphEdge["condition"]; note?: string },
): GraphEdge {
  return {
    id: `rg:${group.id}:${member.nodeId}`,
    from: group.ownerNodeId,
    to: member.nodeId,
    type: "REQUIRES",
    condition: member.condition,
    jurisdictionId: group.jurisdictionId,
    note: member.note,
    verificationStatus: "VERIFIED",
    sources: group.sources,
  };
}

function isDocumentish(node: GraphNode | undefined): boolean {
  return node?.type === "DOCUMENT" || node?.type === "DOCUMENT_GROUP" || node?.type === "OUTPUT";
}

function inferChannelType(node: GraphNode): ChannelType {
  if (node.metadata?.channelType) return node.metadata.channelType;
  switch (node.type) {
    case "MOBILE_APP":
      return "ANDROID_APP";
    case "OFFICE":
      return "PHYSICAL_OFFICE";
    case "HELPLINE":
      return "PHONE";
    case "GRIEVANCE_CHANNEL":
      return "GRIEVANCE_PORTAL";
    default:
      return "WEB";
  }
}

function humanise(field: string): string {
  const bare = field.includes(":") ? (field.split(":")[1] ?? field) : field;
  const spaced = bare.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1) + "?";
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Convenience wrapper matching the spec's `compileJourney(...)` signature. */
export function compileJourney(data: GraphData, request: CompileRequest): CompiledJourney {
  return new JourneyCompiler(data).compile(request);
}
