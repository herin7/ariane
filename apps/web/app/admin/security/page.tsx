import type { Metadata } from "next";
import Link from "next/link";
import { countSince, page } from "../db";
import { requireAdmin } from "../session";
import styles from "../admin.module.css";
import { Metric, Metrics, Shell, Table, shortHash, when } from "../shell";

/**
 * /admin/security — what people tried.
 *
 * §7. Every row here is something the server already refused; this page is the
 * record, not the decision. A model never wrote a row that banned anybody —
 * severity is assigned by server policy and the cooldowns it triggers are on
 * the Voice ops page.
 *
 * §7 again, on the excerpt column: it was redacted before it was stored, so
 * what is printed here is what survived redaction. There is no un-redacted copy
 * to reveal.
 */

export const metadata: Metadata = { title: "Security · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Event {
  id: string;
  created_at: string;
  session_id: string | null;
  auth_user_id: string | null;
  ip_hash: string | null;
  category: string;
  severity: string;
  action_taken: string;
  safe_excerpt: string | null;
}

const DAY = 86_400_000;

export default async function Security({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; severity?: string; category?: string }>;
}) {
  const user = await requireAdmin();
  const query = await searchParams;
  const at = Number(query.page ?? 0) || 0;

  const [events, high24, all24, all7] = await Promise.all([
    page<Event>("security_events", {
      page: at,
      filters: { severity: query.severity, category: query.category },
    }),
    countSince("security_events", DAY, { severity: "HIGH" }),
    countSince("security_events", DAY),
    countSince("security_events", 7 * DAY),
  ]);

  const link = (next: number) => {
    const params = new URLSearchParams({ page: String(next) });
    if (query.severity) params.set("severity", query.severity);
    if (query.category) params.set("category", query.category);
    return `/admin/security?${params}`;
  };

  return (
    <Shell here="/admin/security" user={user}>
      <Metrics>
        <Metric label="High severity, 24h" value={high24} />
        <Metric label="All events, 24h" value={all24} />
        <Metric label="All events, 7 days" value={all7} />
      </Metrics>

      <p className="small faint" style={{ margin: 0 }}>
        <Link href="/admin/security">All</Link> · <Link href="/admin/security?severity=HIGH">High</Link> ·{" "}
        <Link href="/admin/security?category=secret-probe">Secret probes</Link> ·{" "}
        <Link href="/admin/security?category=limit-probe">Limit probes</Link> ·{" "}
        <Link href="/admin/security?category=prompt-injection">Injection</Link> ·{" "}
        <Link href="/admin/security?category=admin-login-failed">Admin logins</Link>
      </p>

      <Table
        page={events}
        href={link}
        empty="Nothing has been refused yet."
        columns={[
          ["When", (row) => when(row.created_at)],
          [
            "Severity",
            (row) => (
              <span className={styles.sev} data-level={row.severity}>
                {row.severity}
              </span>
            ),
          ],
          ["Category", (row) => row.category],
          ["Action", (row) => row.action_taken],
          ["Who", (row) => <code>{row.auth_user_id ? row.auth_user_id.slice(0, 8) : shortHash(row.ip_hash)}</code>],
          [
            "Call",
            (row) =>
              row.session_id ? (
                <Link href={`/admin/conversations?page=0`}>
                  <code>{row.session_id.slice(0, 8)}</code>
                </Link>
              ) : (
                "—"
              ),
          ],
          ["Redacted excerpt", (row) => <span className="small">{row.safe_excerpt ?? "—"}</span>],
        ]}
      />
    </Shell>
  );
}
