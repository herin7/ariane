import type { Metadata } from "next";
import { adminDb, countSince, daily, eventTotals, page } from "../db";
import { requireAdmin } from "../session";
import { Chart, Metric, Metrics, Shell, Table, shortHash, when } from "../shell";

/**
 * /admin/traffic — traction, from Ariane's own rows.
 *
 * §16. No Vercel API token, no vendor dashboard, no third-party key just to
 * render this page: the funnel is `app_events`, which this deployment wrote.
 * Vercel Analytics still runs alongside for the things it is better at, but
 * nothing here depends on it being reachable.
 *
 * §10: the metadata column holds question ids, never answers, so a funnel can
 * be counted without this page being able to read what anybody typed.
 */

export const metadata: Metadata = { title: "Traffic · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

interface Event {
  id: number;
  created_at: string;
  event_name: string;
  path: string | null;
  service_id: string | null;
  anonymous_session_id: string | null;
  auth_user_id: string | null;
  ip_hash: string | null;
}

export default async function Traffic({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireAdmin();
  const at = Number((await searchParams).page ?? 0) || 0;
  const db = adminDb();

  const [totals, chart, views24, recent, visitors] = await Promise.all([
    eventTotals(7 * DAY),
    daily("app_events", 14),
    countSince("app_events", DAY, { event_name: "page_view" }),
    page<Event>("app_events", { page: at }),
    // Distinct visitors is a count of anonymous ids, and PostgREST has no
    // `count(distinct)`. ponytail: read the ids for the window and put them in
    // a Set — swap for a SQL view if a day's events stop fitting in one read.
    db
      ? db
          .from("app_events")
          .select("anonymous_session_id")
          .gte("created_at", new Date(Date.now() - DAY).toISOString())
          .limit(20_000)
      : Promise.resolve({ data: [] as { anonymous_session_id: string | null }[] }),
  ]);

  const unique = new Set(
    ((visitors.data ?? []) as { anonymous_session_id: string | null }[])
      .map((row) => row.anonymous_session_id)
      .filter(Boolean),
  ).size;

  const find = (name: string) => totals.find((row) => row.name === name)?.count ?? 0;
  const searches = find("search_submitted");
  const journeys = find("journey_started");

  return (
    <Shell here="/admin/traffic" user={user}>
      <Metrics>
        <Metric label="Page views, 24h" value={views24} />
        <Metric label="Visitors, 24h" value={unique} />
        <Metric label="Searches, 7 days" value={searches} />
        <Metric label="Journeys started, 7 days" value={journeys} />
        <Metric label="Calls started, 7 days" value={find("voice_started")} />
        <Metric
          label="Search → journey"
          value={searches ? `${Math.round((journeys / searches) * 100)}%` : "—"}
        />
      </Metrics>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Events per day, last 14 days
        </h2>
        <Chart data={chart} label="Events per day" />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Last 7 days by event
        </h2>
        <Table
          page={{ rows: totals, total: totals.length, page: 0, pages: 1 }}
          href={() => "/admin/traffic"}
          empty="No events recorded yet."
          columns={[
            ["Event", (row) => row.name],
            ["Count", (row) => row.count],
          ]}
        />
      </div>

      <div>
        <h2 className="small faint" style={{ margin: "0 0 8px" }}>
          Raw event stream
        </h2>
        <Table
          page={recent}
          href={(next) => `/admin/traffic?page=${next}`}
          empty="No events recorded yet."
          columns={[
            ["When", (row) => when(row.created_at)],
            ["Event", (row) => row.event_name],
            ["Path", (row) => row.path ?? "—"],
            ["Service", (row) => row.service_id ?? "—"],
            [
              "Who",
              (row) => (
                <code>
                  {row.auth_user_id
                    ? row.auth_user_id.slice(0, 8)
                    : (row.anonymous_session_id?.slice(0, 8) ?? shortHash(row.ip_hash))}
                </code>
              ),
            ],
          ]}
        />
      </div>
    </Shell>
  );
}
