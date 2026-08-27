import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin.module.css";
import type { Page } from "./db";

/**
 * The bits every admin page needs: the tab strip, a metric, a bar chart, a
 * table and a pager. One file so six pages stay short.
 *
 * All server components — nothing here hydrates, and nothing here holds any
 * state a browser could send back. §11: the panel is rendered HTML.
 *
 * Not a route.
 */

const TABS = [
  ["/admin", "Overview"],
  ["/admin/conversations", "Conversations"],
  ["/admin/users", "Users"],
  ["/admin/voice", "Voice ops"],
  ["/admin/security", "Security"],
  ["/admin/traffic", "Traffic"],
] as const;

export function Shell({ here, user, children }: { here: string; user: string; children: ReactNode }) {
  return (
    <div className="container">
      <div className={styles.shell}>
        <nav className={styles.tabs} aria-label="Admin sections">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={href === here ? "page" : undefined}>
              {label}
            </Link>
          ))}
          <span className={styles.who}>
            {user} ·{" "}
            <Link href="/admin/logout" prefetch={false}>
              sign out
            </Link>
          </span>
        </nav>
        {children}
      </div>
    </div>
  );
}

export const Metric = ({ label, value }: { label: string; value: string | number }) => (
  <div className={styles.metric}>
    <b>{value}</b>
    <span>{label}</span>
  </div>
);

export const Metrics = ({ children }: { children: ReactNode }) => <div className={styles.metrics}>{children}</div>;

/** Days along the bottom, counts as height. A picture of whether it is growing. */
export function Chart({ data, label }: { data: { day: string; count: number }[]; label: string }) {
  const peak = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className={styles.chart} role="img" aria-label={`${label}: ${data.map((d) => `${d.day} ${d.count}`).join(", ")}`}>
      {data.map((d) => (
        <div key={d.day} style={{ height: `${(d.count / peak) * 100}%` }} title={`${d.day}: ${d.count}`} />
      ))}
    </div>
  );
}

/**
 * A table over a page of rows. `columns` maps a heading to a cell renderer, so
 * a page decides what a row looks like without this file knowing any schema.
 */
export function Table<T>({
  page: data,
  columns,
  href,
  empty = "Nothing yet.",
}: {
  page: Page<T>;
  columns: [string, (row: T) => ReactNode][];
  href: (page: number) => string;
  empty?: string;
}) {
  if (data.rows.length === 0) return <p className="small faint">{empty}</p>;

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map(([heading]) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index}>
                {columns.map(([heading, cell]) => (
                  <td key={heading}>{cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={data} href={href} />
    </>
  );
}

/** Links, not buttons: a page of an admin table is a URL an operator can share. */
function Pager<T>({ data, href }: { data: Page<T>; href: (page: number) => string }) {
  if (data.pages <= 1) return null;
  return (
    <div className={styles.pager}>
      {data.page > 0 && (
        <Link className="small" href={href(data.page - 1)}>
          ← Newer
        </Link>
      )}
      <span>
        Page {data.page + 1} of {data.pages} · {data.total} rows
      </span>
      {data.page + 1 < data.pages && (
        <Link className="small" href={href(data.page + 1)}>
          Older →
        </Link>
      )}
    </div>
  );
}

/** Timestamps, short and local-agnostic. Operators compare rows, not calendars. */
export const when = (value: string | null | undefined): string =>
  value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "—";

export const secs = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? "—" : `${Math.round(ms / 1000)}s`;

/** §12: an ip hash is what an operator sees. The address itself is not stored. */
export const shortHash = (value: string | null | undefined): string => (value ? value.slice(0, 12) : "—");
