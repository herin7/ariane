import type { Metadata } from "next";
import { CAPACITY, TIERS } from "@ariane/voice";
import { adminDb, countSince, page } from "../db";
import { requireAdmin } from "../session";
import { Metric, Metrics, Shell, Table, secs, shortHash, when } from "../shell";

/**
 * /admin/voice — the ten lines, right now.
 *
 * §12. Who is on a line, who is waiting, and who is in a cooldown. This is the
 * page to open when somebody says "it says all the lines are busy": the leases
 * and the queue are the two tables that answer it, and both are Postgres, so
 * this is the truth rather than one Vercel instance's opinion. §4.
 */

export const metadata: Metadata = { title: "Voice ops · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Lease {
  session_id: string;
  auth_user_id: string | null;
  ip_hash: string | null;
  acquired_at: string;
  heartbeat_at: string;
  lease_expires_at: string;
}

interface Queued {
  id: string;
  ip_hash: string | null;
  auth_user_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  waited_ms: number | null;
}

interface Cooling {
  subject: string;
  until: string;
  reason: string;
  created_at: string;
}

export default async function VoiceOps() {
  const user = await requireAdmin();
  const db = adminDb();
  const now = new Date().toISOString();

  const [leases, queue, cooldowns, admitted24, queued24] = await Promise.all([
    db
      ? db.from("voice_capacity_leases").select("*").gte("lease_expires_at", now).order("acquired_at").limit(50)
      : Promise.resolve({ data: [] as Lease[] }),
    page<Queued>("voice_queue", { size: 25, order: "created_at", ascending: true, filters: { status: "WAITING" } }),
    page<Cooling>("ariane_cooldowns", { size: 25, order: "until", filters: {} }),
    countSince("voice_conversations", 86_400_000),
    countSince("voice_queue", 86_400_000),
  ]);

  const live = (leases.data ?? []) as Lease[];

  return (
    <Shell here="/admin/voice" user={user}>
      <Metrics>
        <Metric label="Lines in use" value={`${live.length} / ${CAPACITY.maxConcurrentCalls}`} />
        <Metric label="Waiting" value={queue.total} />
        <Metric label="Admitted, 24h" value={admitted24} />
        <Metric label="Queued, 24h" value={queued24} />
        <Metric label="Guest limit" value={secs(TIERS.GUEST.maxCallMs)} />
        <Metric label="Signed-in limit" value={secs(TIERS.AUTHENTICATED.maxCallMs)} />
      </Metrics>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          On a line now
        </h2>
        <Table
          page={{ rows: live, total: live.length, page: 0, pages: 1 }}
          href={() => "/admin/voice"}
          empty="Every line is free."
          columns={[
            ["Session", (row) => <code>{row.session_id.slice(0, 8)}</code>],
            ["Who", (row) => <code>{row.auth_user_id ? row.auth_user_id.slice(0, 8) : shortHash(row.ip_hash)}</code>],
            ["Since", (row) => when(row.acquired_at)],
            ["Last heartbeat", (row) => when(row.heartbeat_at)],
            ["Lease ends", (row) => when(row.lease_expires_at)],
          ]}
        />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          In the queue
        </h2>
        <Table
          page={queue}
          href={() => "/admin/voice"}
          empty="Nobody is waiting."
          columns={[
            ["Joined", (row) => when(row.created_at)],
            ["Who", (row) => <code>{row.auth_user_id ? row.auth_user_id.slice(0, 8) : shortHash(row.ip_hash)}</code>],
            ["Status", (row) => row.status],
            ["Expires", (row) => when(row.expires_at)],
          ]}
        />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Cooling off
        </h2>
        <Table
          page={cooldowns}
          href={() => "/admin/voice"}
          empty="Nobody is in a cooldown."
          columns={[
            ["Subject", (row) => <code>{row.subject.slice(0, 24)}</code>],
            ["Reason", (row) => row.reason],
            ["Until", (row) => when(row.until)],
            ["Since", (row) => when(row.created_at)],
          ]}
        />
      </div>
    </Shell>
  );
}
