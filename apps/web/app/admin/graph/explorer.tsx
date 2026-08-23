"use client";

import type { CompiledJourney, GraphEdge, GraphNode, ResolvedSource, SourceRef } from "@ariane/core";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { place } from "./place";

/**
 * The proof panel. This renders the exact payload the citizen page renders, so
 * the picture cannot drift from the answer. Same POST, same response, different
 * projection.
 */

const GOALS = ["driving_licence", "learner_licence"];

const TONE: Record<string, string> = {
  SERVICE: "#5b8def",
  DOCUMENT: "#8a63d2",
  DOCUMENT_GROUP: "#8a63d2",
  ELIGIBILITY: "#d2a63f",
  PAYMENT: "#3fa08a",
  ACTION: "#c9743f",
  VERIFICATION: "#c9743f",
  OUTPUT: "#4fae5a",
  PORTAL: "#4a6b8a",
  OFFICE: "#4a6b8a",
  DEPARTMENT: "#4a6b8a",
};

export function GraphExplorer() {
  const [goal, setGoal] = useState(GOALS[0]);
  const [journey, setJourney] = useState<CompiledJourney | null>(null);
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSelected(null);
    fetch("/api/journeys/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" } }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (!r.ok) setError(body.error ?? "Compile failed");
        else { setError(null); setJourney(body as CompiledJourney); }
      })
      .catch(() => live && setError("Could not reach the compiler"));
    return () => { live = false; };
  }, [goal]);

  const flow = useMemo(() => {
    if (!journey) return { nodes: [] as Node[], edges: [] as Edge[] };
    const placed = new Map(place(journey.graph.nodes, journey.graph.edges, journey.goal).map((p) => [p.id, p]));

    const nodes: Node[] = journey.graph.nodes.map((n) => {
      const state = journey.nodeStates[n.id];
      const colour = TONE[n.type] ?? "#666";
      return {
        id: n.id,
        position: { x: placed.get(n.id)?.x ?? 0, y: placed.get(n.id)?.y ?? 0 },
        data: { label: `${n.name}${state ? `\n${state}` : ""}` },
        style: {
          width: 210,
          fontSize: 11,
          whiteSpace: "pre-line",
          borderRadius: 8,
          border: `1px solid ${colour}`,
          background: state === "BLOCKED" ? "#3a1d1d" : "#151719",
          color: "#e8e8e8",
          opacity: state === "SATISFIED" ? 0.55 : 1,
        },
      };
    });

    const edges: Edge[] = journey.graph.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.type,
      animated: e.verificationStatus === "CONFLICTING",
      labelStyle: { fontSize: 9, fill: "#8a8a8a" },
      labelBgStyle: { fill: "#0e0f11" },
      style: {
        stroke: e.verificationStatus === "CONFLICTING" ? "#d2643f" : e.condition ? "#7a6bd2" : "#3a3f45",
        strokeDasharray: e.condition ? "4 3" : undefined,
      },
    }));

    return { nodes, edges };
  }, [journey]);

  if (error) return <p><Link href="/">Back</Link><br />{error}</p>;
  if (!journey) return <p className="muted">Compiling</p>;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Link href="/" className="small">Back</Link>
        <select value={goal} onChange={(e) => setGoal(e.target.value)}>
          {GOALS.map((g) => <option key={g}>{g}</option>)}
        </select>
        <span className="small muted">
          {journey.graph.nodes.length} nodes, {journey.graph.edges.length} edges, {journey.orderedSteps.length} steps
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12, height: "78vh" }}>
        <div style={{ border: "1px solid #24272b", borderRadius: 10, overflow: "hidden" }}>
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            colorMode="dark"
            fitView
            onNodeClick={(_, n) => setSelected({ kind: "node", id: n.id })}
            onEdgeClick={(_, e) => setSelected({ kind: "edge", id: e.id })}
            onPaneClick={() => setSelected(null)}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <div style={{ overflowY: "auto" }}>
          <Inspector journey={journey} selected={selected} />
        </div>
      </div>

      <p className="small muted">
        Dashed edges are conditional. Animated edges are where official sources disagree with each other.
      </p>
    </>
  );
}

function Inspector({
  journey,
  selected,
}: {
  journey: CompiledJourney;
  selected: { kind: "node" | "edge"; id: string } | null;
}) {
  if (!selected) {
    return (
      <div className="card">
        <h3>Nothing selected</h3>
        <p className="small muted">
          Click a node or an edge. Every one of them carries the page it came from and the sentence on that page.
        </p>
        {journey.trace.map((t, i) => (
          <p key={i} className="small" style={{ margin: "2px 0" }}>
            <span className="muted">{t.stage}:</span> {t.detail}
          </p>
        ))}
      </div>
    );
  }

  if (selected.kind === "node") {
    const node = journey.graph.nodes.find((n) => n.id === selected.id);
    if (!node) return <div className="card"><h3>Gone</h3></div>;
    return <NodePanel node={node} state={journey.nodeStates[node.id]} sources={journey.sources} />;
  }

  const edge = journey.graph.edges.find((e) => e.id === selected.id);
  if (!edge) return <div className="card"><h3>Gone</h3></div>;
  return <EdgePanel edge={edge} journey={journey} />;
}

function NodePanel({ node, state, sources }: { node: GraphNode; state?: string; sources: ResolvedSource[] }) {
  return (
    <div className="card">
      <span className="tag">{node.type}</span> {state ? <span className="tag">{state}</span> : null}
      <h3>{node.name}</h3>
      {node.officialName ? <p className="muted small">Officially: {node.officialName}</p> : null}
      {node.description ? <p className="small">{node.description}</p> : null}
      <p className="small muted">
        {node.id}
        <br />
        Scope: {node.jurisdictionId ?? "national"}
      </p>
      {node.metadata ? <Meta metadata={node.metadata as Record<string, unknown>} /> : null}
      <Evidence refs={node.sources} sources={sources} />
    </div>
  );
}

function EdgePanel({ edge, journey }: { edge: GraphEdge; journey: CompiledJourney }) {
  const name = (id: string) => journey.graph.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="card">
      <span className="tag">{edge.type}</span>{" "}
      <span className={`tag${edge.verificationStatus === "CONFLICTING" ? " warn" : ""}`}>{edge.verificationStatus}</span>
      <h3 style={{ fontSize: 14 }}>{name(edge.from)} &rarr; {name(edge.to)}</h3>
      {edge.note ? <p className="small">{edge.note}</p> : null}
      {edge.condition ? (
        <>
          <p className="small" style={{ marginBottom: 2 }}><b>Applies only when</b></p>
          <pre className="evidence" style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>
            {JSON.stringify(edge.condition, null, 2)}
          </pre>
        </>
      ) : null}
      <p className="small muted">
        {edge.id}
        <br />
        Scope: {edge.jurisdictionId ?? "national"}
      </p>
      <Evidence refs={edge.sources} sources={journey.sources} />
    </div>
  );
}

function Meta({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return null;
  return (
    <ul className="small">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="muted">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ refs, sources }: { refs?: SourceRef[]; sources: ResolvedSource[] }) {
  if (!refs?.length) return <p className="small muted">Not verified yet.</p>;
  return (
    <>
      <p className="small" style={{ marginBottom: 2 }}><b>Evidence</b></p>
      {refs.map((r, i) => {
        const source = sources.find((s) => s.source.id === r.sourceId)?.source;
        return (
          <div key={i} className="evidence">
            {r.evidence ? <>&ldquo;{r.evidence}&rdquo;<br /></> : <span className="muted">No quote captured.</span>}
            {source ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="small">{source.title}</a>
            ) : (
              <span className="small muted">{r.sourceId}</span>
            )}{" "}
            <span className="muted small">
              {source ? `retrieved ${source.retrievedAt}` : ""}
              {r.confidence !== undefined ? ` · confidence ${r.confidence}` : ""}
              {r.verificationStatus ? ` · ${r.verificationStatus}` : ""}
            </span>
          </div>
        );
      })}
    </>
  );
}
