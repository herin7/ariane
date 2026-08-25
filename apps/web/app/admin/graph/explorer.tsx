"use client";

import type { CompiledJourney, GraphEdge, GraphNode, ResolvedSource, SourceRef } from "@ariane/core";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { place } from "./place";
import { SPINE_NOTE, isSpine, spine, type Citizen } from "./spine";

/**
 * How Ariane figured it out.
 *
 * This renders the exact payload the citizen page renders, so the picture
 * cannot drift from the answer. Same POST, same response, different projection.
 *
 * §11. It draws one compiled journey, which is forty or so nodes, and never the
 * catalogue. A picture of three thousand nodes proves nothing to anybody: it is
 * a screensaver that happens to be true.
 */

/**
 * Who we are compiling for. One constant, because the graph the citizen is
 * shown and the person drawn at the left of it have to be the same claim.
 */
const WHO: Citizen = { country: "India", state: "Gujarat", district: "Ahmedabad" };

export interface GoalOption {
  id: string;
  name: string;
}

/**
 * §12. Three tiers, not a twelve colour legend nobody reads.
 *
 * The thing you asked for is the accent. Things you have to obtain are ink.
 * Places, portals and phone numbers are the quiet ones, because they are where
 * you go rather than what you get.
 */
const TONE: Record<string, string> = {
  SERVICE: "var(--accent)",
  OUTPUT: "var(--good)",
  DOCUMENT: "var(--ink-soft)",
  DOCUMENT_GROUP: "var(--ink-soft)",
  ELIGIBILITY: "var(--warn)",
  ACTION: "var(--ink-soft)",
  VERIFICATION: "var(--ink-soft)",
  PAYMENT: "var(--ink-soft)",
};

export function GraphExplorer({ goals }: { goals: GoalOption[] }) {
  // Arriving from a journey means the answer is already chosen. Landing here
  // cold means picking one.
  const asked = useSearchParams().get("goal");
  const [goal, setGoal] = useState(
    (asked && goals.find((g) => g.id === asked || g.id === `service:${asked}`)?.id) ?? goals[0]?.id ?? "",
  );
  const [filter, setFilter] = useState("");
  const [journey, setJourney] = useState<CompiledJourney | null>(null);
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSelected(null);
    fetch("/api/journeys/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, jurisdiction: { country: WHO.country, state: WHO.state, district: WHO.district } }),
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
      const colour = TONE[n.type] ?? "var(--faint)";
      const root = n.id === journey.goal;
      return {
        id: n.id,
        position: { x: placed.get(n.id)?.x ?? 0, y: placed.get(n.id)?.y ?? 0 },
        data: { label: n.name },
        style: {
          width: 200,
          padding: "9px 11px",
          fontSize: 11.5,
          fontWeight: root ? 640 : 500,
          textAlign: "left" as const,
          lineHeight: 1.35,
          borderRadius: 10,
          border: `1.5px solid ${state === "BLOCKED" ? "var(--bad)" : colour}`,
          background: root ? "var(--accent-soft)" : state === "BLOCKED" ? "var(--bad-soft)" : "var(--paper)",
          color: "var(--ink)",
          boxShadow: "var(--lift)",
          // A satisfied node is done, not gone. Dimmed, still readable.
          opacity: state === "SATISFIED" ? 0.5 : 1,
        },
      };
    });

    const edges: Edge[] = journey.graph.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.type.replace(/_/g, " ").toLowerCase(),
      // The one thing worth animating: the places the government contradicts
      // itself. Everything else holds still. §13.
      animated: e.verificationStatus === "CONFLICTING",
      labelStyle: { fontSize: 9, fill: "var(--faint)" },
      labelBgStyle: { fill: "var(--bg)" },
      style: {
        strokeWidth: 1.5,
        stroke: e.verificationStatus === "CONFLICTING" ? "var(--bad)" : e.condition ? "var(--warn)" : "var(--line-strong)",
        strokeDasharray: e.condition ? "4 3" : undefined,
      },
    }));

    // The citizen, drawn to the left of everything the state asks of them. A
    // presentation layer: nothing below is written back to the graph and every
    // line it adds is dashed, because none of it came off a government page.
    const me = spine(journey, WHO);
    return { nodes: [...me.nodes, ...nodes], edges: [...me.edges, ...edges] };
  }, [journey]);

  // A dropdown of every service was fine at twenty eight and is a scroll at five
  // hundred. Typing narrows it; the service currently drawn is never filtered
  // away, or the picker would name one thing while the graph shows another.
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return goals;
    const hit = goals.filter((g) => g.name.toLowerCase().includes(query));
    return hit.some((g) => g.id === goal) ? hit : [...goals.filter((g) => g.id === goal), ...hit];
  }, [goals, filter, goal]);

  const back = asked ? `/journey?goal=${encodeURIComponent(goal)}` : "/";

  if (error) {
    return (
      <div className="card">
        <h3>We could not draw that one</h3>
        <p className="small muted">{error}</p>
        <Link href={back} className="small">Go back</Link>
      </div>
    );
  }

  return (
    <div className="bleed">
      <Link href={back} className="small muted" style={{ textDecoration: "none" }}>‹ Back</Link>
      <h1 style={{ marginTop: 12, fontSize: "clamp(26px, 4vw, 34px)" }}>How Ariane figured this out</h1>
      <p className="lede">
        This is the same answer you just read, drawn instead of listed. Click anything, a box or a
        line between two boxes, and it will show you the government page it came from and the
        sentence on that page.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${goals.length} services`}
          style={{ width: 190, padding: "8px 12px", fontSize: 14 }}
          aria-label="Filter services"
        />
        <select
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          style={{ padding: "8px 12px", fontSize: 14, maxWidth: 320 }}
          aria-label="Service to draw"
        >
          {shown.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className="graph-split">
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--paper)" }}>
          {journey ? (
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              colorMode="light"
              fitView
              // Never zoom past 1:1 on a small journey, and do not spend a
              // tenth of the canvas on margin around a big one.
              fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
              minZoom={0.15}
              proOptions={{ hideAttribution: false }}
              onNodeClick={(_, n) => setSelected({ kind: "node", id: n.id })}
              onEdgeClick={(_, e) => setSelected({ kind: "edge", id: e.id })}
              onPaneClick={() => setSelected(null)}
            >
              <Background color="var(--line)" gap={22} />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
              <p className="muted small">Drawing</p>
            </div>
          )}
        </div>

        <div style={{ overflowY: "auto" }}>
          {journey ? <Inspector journey={journey} selected={selected} /> : null}
        </div>
      </div>

      <p className="small faint" style={{ marginTop: 12 }}>
        The circles on the left are you, not the government, and the dashed lines around them are
        the only ones in this picture with no page behind them. Everywhere else a dashed line
        applies only in some cases, and a moving line is where official pages contradict each
        other and we kept both rather than picking one.
        {journey ? ` ${journey.graph.nodes.length} boxes, ${journey.graph.edges.length} lines.` : ""}
      </p>
    </div>
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
        {/* Not "on the left". On a phone this panel is underneath the picture. */}
        <h3>Pick anything in the picture</h3>
        <p className="small muted">
          Every box and every line carries the page it came from and the sentence on that page. In the
          meantime, here is the order the compiler did the work in.
        </p>
        {journey.trace.map((t, i) => (
          <p key={i} className="small" style={{ margin: "3px 0" }}>
            <span className="mono faint">{t.stage}</span> {t.detail}
          </p>
        ))}
      </div>
    );
  }

  if (selected.kind === "node") {
    if (isSpine(selected.id)) {
      return (
        <div className="card">
          <span className="tag">you</span>
          <h3 style={{ marginTop: 8 }}>Not a government fact</h3>
          <p className="small muted" style={{ margin: "8px 0 0" }}>{SPINE_NOTE}</p>
        </div>
      );
    }
    const node = journey.graph.nodes.find((n) => n.id === selected.id);
    if (!node) return <div className="card"><h3>That one is gone</h3></div>;
    return <NodePanel node={node} state={journey.nodeStates[node.id]} sources={journey.sources} />;
  }

  if (isSpine(selected.id)) {
    return (
      <div className="card">
        <span className="tag">you</span>
        <h3 style={{ marginTop: 8 }}>Not a government fact</h3>
        <p className="small muted" style={{ margin: "8px 0 0" }}>{SPINE_NOTE}</p>
      </div>
    );
  }

  const edge = journey.graph.edges.find((e) => e.id === selected.id);
  if (!edge) return <div className="card"><h3>That one is gone</h3></div>;
  return <EdgePanel edge={edge} journey={journey} />;
}

function NodePanel({ node, state, sources }: { node: GraphNode; state?: string; sources: ResolvedSource[] }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <span className="tag">{node.type.replace(/_/g, " ").toLowerCase()}</span>
        {state ? <span className={`tag ${state === "BLOCKED" ? "bad" : state === "SATISFIED" ? "good" : ""}`}>{state.replace(/_/g, " ").toLowerCase()}</span> : null}
      </div>
      <h3>{node.name}</h3>
      {node.officialName ? <p className="faint small" style={{ margin: "2px 0 0" }}>Officially: {node.officialName}</p> : null}
      {node.description ? <p className="small" style={{ margin: "8px 0 0" }}>{node.description}</p> : null}
      <p className="small faint" style={{ margin: "10px 0 0" }}>
        <span className="mono">{node.id}</span>
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
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <span className="tag">{edge.type.replace(/_/g, " ").toLowerCase()}</span>
        <span className={`tag${edge.verificationStatus === "CONFLICTING" ? " warn" : ""}`}>
          {edge.verificationStatus.toLowerCase()}
        </span>
      </div>
      <h3 style={{ fontSize: 15 }}>{name(edge.from)} &rarr; {name(edge.to)}</h3>
      {edge.note ? <p className="small" style={{ margin: "8px 0 0" }}>{edge.note}</p> : null}
      {edge.condition ? (
        <>
          <p className="small" style={{ margin: "10px 0 2px" }}><b>Applies only when</b></p>
          <pre className="evidence mono" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(edge.condition, null, 2)}
          </pre>
        </>
      ) : null}
      <p className="small faint" style={{ margin: "10px 0 0" }}>
        <span className="mono">{edge.id}</span>
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
    <ul className="small" style={{ marginTop: 10 }}>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="faint">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ refs, sources }: { refs?: SourceRef[]; sources: ResolvedSource[] }) {
  if (!refs?.length) return <p className="small faint" style={{ marginTop: 10 }}>Not verified yet.</p>;
  return (
    <>
      <p className="small" style={{ margin: "14px 0 2px" }}><b>The proof</b></p>
      {refs.map((r, i) => {
        const source = sources.find((s) => s.source.id === r.sourceId)?.source;
        return (
          <div key={i} className="evidence">
            {r.evidence ? <span className="quote">&ldquo;{r.evidence}&rdquo;</span> : <span className="faint">No quote captured.</span>}
            <br />
            {source ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="small">{source.title}</a>
            ) : (
              <span className="small mono faint">{r.sourceId}</span>
            )}{" "}
            <span className="faint small">
              {source ? `retrieved ${source.retrievedAt}` : ""}
              {r.verificationStatus ? ` · ${r.verificationStatus.toLowerCase()}` : ""}
              {source?.tlsVerified === false ? " · unverified certificate" : ""}
            </span>
          </div>
        );
      })}
    </>
  );
}
