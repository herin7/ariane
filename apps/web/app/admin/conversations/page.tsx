import type { Metadata } from "next";
import Link from "next/link";
import { page } from "../db";
import { requireAdmin } from "../session";
import { Shell, Table, secs, shortHash, when } from "../shell";

/**
 * /admin/conversations — every call, newest first.
 *
 * §12. Fifty at a time, from the server, filtered by tier through the query
 * string so an operator can link somebody straight to what they were looking
 * at. The transcript itself is one click further in, because a list of a
 * hundred transcripts is not a list anyone reads.
 */

export const metadata: Metadata = { title: "Conversations · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Call {
  id: string;
  tier: string;
  started_at: string;
  duration_ms: number | null;
  turn_count: number;
  tool_count: number;
  end_reason: string | null;
  service_id: string | null;
  language: string | null;
  ip_hash: string | null;
  auth_user_id: string | null;
  queue_wait_ms: number | null;
}

export default async function Conversations({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tier?: string; user?: string }>;
}) {
  const user = await requireAdmin();
  const query = await searchParams;
  const at = Number(query.page ?? 0) || 0;

  const calls = await page<Call>("voice_conversations", {
    page: at,
    order: "started_at",
    filters: { tier: query.tier, auth_user_id: query.user },
  });

  const link = (next: number) => {
    const params = new URLSearchParams({ page: String(next) });
    if (query.tier) params.set("tier", query.tier);
    if (query.user) params.set("user", query.user);
    return `/admin/conversations?${params}`;
  };

  return (
    <Shell here="/admin/conversations" user={user}>
      <p className="small faint" style={{ margin: 0 }}>
        <Link href="/admin/conversations">All</Link> · <Link href="/admin/conversations?tier=GUEST">Guest</Link> ·{" "}
        <Link href="/admin/conversations?tier=AUTHENTICATED">Signed in</Link>
        {query.user ? ` · filtered to one user` : ""}
      </p>

      <Table
        page={calls}
        href={link}
        empty="No calls recorded yet."
        columns={[
          ["Started", (row) => <Link href={`/admin/conversations/${row.id}`}>{when(row.started_at)}</Link>],
          ["Tier", (row) => row.tier],
          ["Who", (row) => <code>{row.auth_user_id ? row.auth_user_id.slice(0, 8) : shortHash(row.ip_hash)}</code>],
          ["Length", (row) => secs(row.duration_ms)],
          ["Waited", (row) => secs(row.queue_wait_ms)],
          ["Turns", (row) => row.turn_count],
          ["Tools", (row) => row.tool_count],
          ["Service", (row) => row.service_id ?? "—"],
          ["Ended", (row) => row.end_reason ?? "live"],
        ]}
      />
    </Shell>
  );
}
