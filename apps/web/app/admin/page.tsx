import type { Metadata } from "next";
import Link from "next/link";
import { CAPACITY } from "@ariane/voice";
import { adminDb, countSince, daily, page } from "./db";
import { requireAdmin } from "./session";
import { Chart, Metric, Metrics, Shell, secs, when } from "./shell";

/**
 * /admin — what happened, at a glance.
 *
 * §12. Six numbers an operator actually acts on, two charts for the shape of a
 * fortnight, and the last ten calls. Everything else is a tab.
 *
 * `requireAdmin` is the first statement, and it redirects rather than returning
 * a 403, so an unauthenticated request never reaches a query. §11, §13.
 */

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

interface Call {
  id: string;
  tier: string;
  started_at: string;
  duration_ms: number | null;
  turn_count: number;
  end_reason: string | null;
  service_id: string | null;
}

export default async function AdminOverview() {
  const user = await requireAdmin();
  const db = adminDb();

  const [calls24, calls7, events24, security7, logins7, recent, callChart, eventChart, live] = await Promise.all([
    countSince("voice_conversations", DAY),
    countSince("voice_conversations", 7 * DAY),
    countSince("app_events", DAY),
    countSince("security_events", 7 * DAY, { severity: "HIGH" }),
    countSince("app_events", 7 * DAY, { event_name: "login_completed" }),
    page<Call>("voice_conversations", {
      order: "started_at",
      size: 10,
      select: "id,tier,started_at,duration_ms,turn_count,end_reason,service_id",
    }),
    daily("voice_conversations", 14, "started_at"),
    daily("app_events", 14),
    db?.from("voice_capacity_leases").select("*", { count: "exact", head: true }).gte("lease_expires_at", new Date().toISOString()),
  ]);

  return (
    <Shell here="/admin" user={user}>
      {!db && (
        <p className="small" style={{ color: "var(--warn)" }}>
          No database is configured on this deployment, so every number below is zero.
        </p>
      )}

      <Metrics>
        <Metric label="Calls, last 24h" value={calls24} />
        <Metric label="Calls, last 7 days" value={calls7} />
        <Metric label="On a line now" value={`${live?.count ?? 0} / ${CAPACITY.maxConcurrentCalls}`} />
        <Metric label="Events, last 24h" value={events24} />
        <Metric label="Sign-ins, last 7 days" value={logins7} />
        <Metric label="High severity, 7 days" value={security7} />
      </Metrics>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Calls per day, last 14 days
        </h2>
        <Chart data={callChart} label="Calls per day" />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Product events per day, last 14 days
        </h2>
        <Chart data={eventChart} label="Events per day" />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Latest calls
        </h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {recent.rows.map((call) => (
            <li key={call.id}>
              <Link href={`/admin/conversations/${call.id}`}>{when(call.started_at)}</Link> · {call.tier} ·{" "}
              {secs(call.duration_ms)} · {call.turn_count} turns · {call.end_reason ?? "live"}
              {call.service_id ? ` · ${call.service_id}` : ""}
            </li>
          ))}
          {recent.rows.length === 0 && <li className="faint">No calls recorded yet.</li>}
        </ul>
      </div>
    </Shell>
  );
}
