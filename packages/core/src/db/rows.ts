import type { GraphBundle } from "../data/index";
import type { GraphEdge, GraphNode, Jurisdiction, QuestionDefinition, RequirementGroup, Source } from "../types";

/**
 * The translation between the ontology and the tables.
 *
 * Kept as pure functions with no database anywhere near them, because the
 * round trip is the only part of the persistence layer that can silently
 * corrupt a government fact, and this way it is testable on a laptop with no
 * credentials. `rows.test.ts` pushes the whole real seed through both
 * directions and asserts it comes back byte identical.
 *
 * Undefined and null are not the same thing here. A column that is null in
 * Postgres has to come back as an absent key, or every optional field in the
 * graph turns into an explicit `undefined` and deep equality stops holding.
 */

export interface GraphRows {
  journeys: { id: string; name: string }[];
  sources: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  requirement_groups: Record<string, unknown>[];
  questions: Record<string, unknown>[];
  escalation_templates: Record<string, unknown>[];
}

/** Drop keys whose value is null or undefined, so optional stays optional. */
function compact<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) as T;
}

export function jurisdictionRows(jurisdictions: Jurisdiction[]): Record<string, unknown>[] {
  return jurisdictions.map((j) => compact({ id: j.id, parent_id: j.parentId, level: j.level, name: j.name }));
}

export function toJurisdictions(rows: Record<string, unknown>[]): Jurisdiction[] {
  return rows.map((r) => compact({ id: r.id, parentId: r.parent_id, level: r.level, name: r.name })) as unknown as Jurisdiction[];
}

export function toRows(bundles: GraphBundle[]): GraphRows {
  const rows: GraphRows = { journeys: [], sources: [], nodes: [], edges: [], requirement_groups: [], questions: [], escalation_templates: [] };

  for (const bundle of bundles) {
    const journeyId = bundle.id;
    rows.journeys.push({ id: journeyId, name: journeyId });

    for (const s of bundle.sources) {
      rows.sources.push(compact({
        id: s.id,
        journey_id: journeyId,
        url: s.url,
        title: s.title,
        domain: s.domain,
        source_type: s.sourceType,
        jurisdiction_id: s.jurisdictionId,
        retrieved_at: s.retrievedAt,
        content_hash: s.contentHash,
        tls_verified: s.tlsVerified,
      }));
    }

    for (const n of bundle.nodes) {
      rows.nodes.push(compact({
        id: n.id,
        journey_id: journeyId,
        type: n.type,
        name: n.name,
        official_name: n.officialName,
        aliases: n.aliases ?? [],
        description: n.description,
        jurisdiction_id: n.jurisdictionId,
        metadata: n.metadata ?? {},
        sources: n.sources ?? [],
        last_verified_at: n.lastVerifiedAt,
      }));
    }

    for (const e of bundle.edges) {
      rows.edges.push(compact({
        id: e.id,
        journey_id: journeyId,
        from_node: e.from,
        to_node: e.to,
        type: e.type,
        jurisdiction_id: e.jurisdictionId,
        verification_status: e.verificationStatus,
        note: e.note,
        condition: e.condition,
        valid_from: e.validFrom,
        valid_until: e.validUntil,
        sources: e.sources ?? [],
      }));
    }

    for (const g of bundle.requirementGroups) {
      rows.requirement_groups.push(compact({
        id: g.id,
        journey_id: journeyId,
        owner_node_id: g.ownerNodeId,
        mode: g.mode,
        minimum_required: g.minimumRequired,
        condition: g.condition,
        jurisdiction_id: g.jurisdictionId,
        members: g.members ?? [],
        sources: g.sources ?? [],
      }));
    }

    for (const q of bundle.questions) {
      rows.questions.push(compact({
        field: q.field,
        journey_id: journeyId,
        label: q.label,
        help: q.help,
        input_type: q.inputType,
        options: q.options,
      }));
    }

    // Templates carry `*` in place of a service id, so they get their own
    // table rather than failing `edges`' foreign key on every insert.
    for (const t of bundle.edgeTemplates ?? []) {
      rows.escalation_templates.push(compact({
        id: t.id,
        journey_id: journeyId,
        to_node: t.to,
        type: t.type,
        jurisdiction_id: t.jurisdictionId,
        verification_status: t.verificationStatus,
        note: t.note,
        sources: t.sources ?? [],
      }));
    }
  }

  return rows;
}

/**
 * Rows back into bundles, grouped by journey. Order within a journey is
 * preserved from the row order the caller passes in, so the reader is
 * responsible for asking Postgres for a deterministic one.
 */
export function toBundles(rows: GraphRows): GraphBundle[] {
  const byId = new Map<string, GraphBundle>();
  const bundle = (id: unknown): GraphBundle => {
    const key = String(id);
    let found = byId.get(key);
    if (!found) {
      found = { id: key, sources: [], nodes: [], edges: [], requirementGroups: [], questions: [] };
      byId.set(key, found);
    }
    return found;
  };

  for (const j of rows.journeys) bundle(j.id);

  for (const r of rows.sources) {
    bundle(r.journey_id).sources.push(compact({
      id: r.id,
      url: r.url,
      title: r.title,
      domain: r.domain,
      sourceType: r.source_type,
      jurisdictionId: r.jurisdiction_id,
      retrievedAt: r.retrieved_at,
      contentHash: r.content_hash,
      tlsVerified: r.tls_verified,
    }) as unknown as Source);
  }

  for (const r of rows.nodes) {
    // An empty aliases array is what the column defaults to, and is not the
    // same claim as "this node listed no aliases". Treat it as absent.
    const aliases = r.aliases as string[] | undefined;
    bundle(r.journey_id).nodes.push(compact({
      id: r.id,
      type: r.type,
      name: r.name,
      officialName: r.official_name,
      aliases: aliases?.length ? aliases : undefined,
      description: r.description,
      jurisdictionId: r.jurisdiction_id,
      metadata: Object.keys((r.metadata ?? {}) as object).length ? r.metadata : undefined,
      sources: r.sources,
      lastVerifiedAt: r.last_verified_at,
    }) as unknown as GraphNode);
  }

  for (const r of rows.edges) {
    bundle(r.journey_id).edges.push(compact({
      id: r.id,
      from: r.from_node,
      to: r.to_node,
      type: r.type,
      jurisdictionId: r.jurisdiction_id,
      verificationStatus: r.verification_status,
      note: r.note,
      condition: r.condition,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      sources: r.sources,
    }) as unknown as GraphEdge);
  }

  for (const r of rows.requirement_groups) {
    bundle(r.journey_id).requirementGroups.push(compact({
      id: r.id,
      ownerNodeId: r.owner_node_id,
      mode: r.mode,
      minimumRequired: r.minimum_required,
      condition: r.condition,
      jurisdictionId: r.jurisdiction_id,
      members: r.members,
      sources: r.sources,
    }) as unknown as RequirementGroup);
  }

  for (const r of rows.questions) {
    bundle(r.journey_id).questions.push(compact({
      field: r.field,
      label: r.label,
      help: r.help,
      inputType: r.input_type,
      options: r.options,
    }) as unknown as QuestionDefinition);
  }

  for (const r of rows.escalation_templates ?? []) {
    const target = bundle(r.journey_id);
    (target.edgeTemplates ??= []).push(compact({
      id: r.id,
      from: "*",
      to: r.to_node,
      type: r.type,
      jurisdictionId: r.jurisdiction_id,
      verificationStatus: r.verification_status,
      note: r.note,
      sources: r.sources,
    }) as unknown as GraphEdge);
  }

  return [...byId.values()];
}
