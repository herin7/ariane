import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "../../db";
import { requireAdmin } from "../../session";
import styles from "../../admin.module.css";
import { Metric, Metrics, Shell, secs, shortHash, when } from "../../shell";

/**
 * One call, readable top to bottom.
 *
 * §12: what the citizen said, what Ariane said back, and every tool the model
 * proposed, in the order they happened. This is the whole reason the panel
 * exists.
 *
 * §9: the text was redacted on the way in, not on the way out. Nothing here
 * un-redacts anything, and there is no audio to play because none was kept.
 */

export const metadata: Metadata = { title: "Call · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Turn {
  sequence: number;
  role: string;
  text: string;
  created_at: string;
  guardrail_status: string | null;
}

interface Tool {
  tool_name: string;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const db = adminDb();
  if (!db) notFound();

  const { data: call } = await db.from("voice_conversations").select("*").eq("id", id).maybeSingle();
  if (!call) notFound();

  const [{ data: turns }, { data: tools }] = await Promise.all([
    db.from("voice_turns").select("sequence,role,text,created_at,guardrail_status").eq("conversation_id", id).order("sequence").limit(500),
    db.from("voice_tool_events").select("tool_name,status,duration_ms,created_at").eq("conversation_id", id).order("created_at").limit(500),
  ]);

  // Two streams, one timeline. Merged by time so a tool call appears where the
  // model actually made it rather than in a separate list nobody correlates.
  const timeline = [
    ...((turns ?? []) as Turn[]).map((turn) => ({ at: turn.created_at, role: turn.role, text: turn.text, note: turn.guardrail_status })),
    ...((tools ?? []) as Tool[]).map((tool) => ({
      at: tool.created_at,
      role: "TOOL",
      text: `${tool.tool_name} → ${tool.status}${tool.duration_ms ? ` (${tool.duration_ms}ms)` : ""}`,
      note: null as string | null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const row = call as Record<string, string | number | null>;

  return (
    <Shell here="/admin/conversations" user={user}>
      <p className="small">
        <Link href="/admin/conversations">← All conversations</Link>
      </p>

      <Metrics>
        <Metric label="Tier" value={String(row.tier)} />
        <Metric label="Length" value={secs(row.duration_ms as number | null)} />
        <Metric label="Turns" value={Number(row.turn_count ?? 0)} />
        <Metric label="Tool calls" value={Number(row.tool_count ?? 0)} />
        <Metric label="Ended" value={String(row.end_reason ?? "live")} />
        <Metric label="Risk" value={Number(row.risk_score ?? 0)} />
      </Metrics>

      <p className="small faint" style={{ margin: 0 }}>
        Started {when(row.started_at as string)} · identity {String(row.identity_level)} · language{" "}
        {String(row.language ?? "—")} ·{" "}
        {row.auth_user_id ? (
          <Link href={`/admin/conversations?user=${row.auth_user_id}`}>user {String(row.auth_user_id).slice(0, 8)}</Link>
        ) : (
          <>ip {shortHash(row.ip_hash as string | null)}</>
        )}
        {row.service_id ? ` · ${row.service_id}` : ""}
      </p>

      <div>
        {timeline.map((entry, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className={styles.turn} data-role={entry.role}>
            <b>{entry.role === "USER" ? "Citizen" : entry.role === "ASSISTANT" ? "Ariane" : "Tool call"}</b>
            <div>
              {entry.text}
              {entry.note && entry.note !== "OK" && (
                <span className="small" style={{ color: "var(--warn)" }}>
                  {" "}
                  · {entry.note}
                </span>
              )}
            </div>
          </div>
        ))}
        {timeline.length === 0 && (
          <p className="small faint">
            No transcript for this call. Assistant turns are always recorded; the citizen&rsquo;s side needs caller
            transcription enabled on the voice provider.
          </p>
        )}
      </div>
    </Shell>
  );
}
