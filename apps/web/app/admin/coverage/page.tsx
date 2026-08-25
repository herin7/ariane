import { coverage } from "@ariane/core/server";
import Link from "next/link";

export const metadata = { title: "The state of the map" };

/**
 * What we know, and how well we know it.
 *
 * The same numbers `pnpm coverage` prints, on a page, because the honest answer
 * to "is this ready" is a table and not a demo. A journey with a hundred nodes
 * and no quote on any of them is worse than one with nine, since it looks
 * finished. This is where that shows.
 *
 * Read off the checked in bundles rather than the database on purpose: it
 * reports what we shipped, not what somebody edited in Supabase five minutes
 * ago. Nothing here is recomputed live, so it can be static.
 *
 * Eleven numeric columns do not fit a phone and never will, so the table lives
 * in its own scroller. The page does not move sideways; the table does, which
 * is the one place a citizen expects it to.
 */

export default function CoveragePage() {
  const all = coverage();
  const total = (pick: (c: (typeof all)[number]) => number) => all.reduce((sum, c) => sum + pick(c), 0);
  const checked = total((c) => c.byStatus.VERIFIED ?? 0);
  const machine = total((c) => c.byStatus.EXTRACTED ?? 0);
  const conflicting = total((c) => c.byStatus.CONFLICTING ?? 0);
  const unsourced = all.flatMap((c) => c.unsourced);
  const gaps = all.filter((c) => c.notFound.length).map((c) => [c.journey, c.notFound] as const);

  return (
    <div className="wide-page" data-reveal>
      <p className="small">
        <Link href="/">Back</Link> · <Link href="/admin/graph">Draw the graph</Link>
      </p>
      <h1>The state of the map</h1>
      <p className="lede">
        {total((c) => c.services)} services across {all.length} journeys, and an honest account of which parts of
        that we have actually read.
      </p>

      <div className="stat-row">
        <div className="stat">
          <b>{checked.toLocaleString()}</b>
          <span>quotes a person read and confirmed</span>
        </div>
        <div className="stat">
          <b>{machine.toLocaleString()}</b>
          <span>a machine extracted and proved word for word against the page</span>
        </div>
        <div className="stat">
          <b>{conflicting.toLocaleString()}</b>
          <span>places two official sources disagree, both kept</span>
        </div>
        <div className="stat">
          <b>{total((c) => c.notFound.length).toLocaleString()}</b>
          <span>things we looked for and could not find, written down</span>
        </div>
      </div>

      <p className="small muted">
        Neither of the first two numbers means the page is still current. Only that the quote is really on it.
      </p>

      <div className="scroll-x" style={{ marginTop: 22 }}>
        <table className="grid">
          <thead>
            <tr>
              <th className="left">journey</th>
              <th>services</th>
              <th>documents</th>
              <th>offices</th>
              <th>helplines</th>
              <th>edges</th>
              <th>checked</th>
              <th>extracted</th>
              <th>conflicting</th>
              <th>unsourced</th>
              <th>not found</th>
            </tr>
          </thead>
          <tbody>
            {all.map((c) => (
              <tr key={c.journey}>
                <td className="left">{c.journey}</td>
                <td>{c.services}</td>
                <td>{c.documents}</td>
                <td>{c.offices}</td>
                <td>{c.helplines}</td>
                <td>{c.edges}</td>
                <td>{c.byStatus.VERIFIED ?? 0}</td>
                <td>{c.byStatus.EXTRACTED ?? 0}</td>
                <td style={{ color: c.byStatus.CONFLICTING ? "var(--warn)" : undefined }}>
                  {c.byStatus.CONFLICTING ?? 0}
                </td>
                <td style={{ color: c.unsourced.length ? "var(--bad)" : undefined }}>{c.unsourced.length}</td>
                <td>{c.notFound.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        <b>conflicting</b> is two sources that disagree, both kept, neither picked. <b>not found</b> is something
        we looked for and could not find, written down rather than guessed. Both are wanted. <b>unsourced</b> is
        the only column that is a fault: a requirement we would put in front of a citizen with nothing to show
        for it. {unsourced.length === 0 ? "There are none." : `There are ${unsourced.length}.`}
      </p>

      {total((c) => c.unfetched) > 0 ? (
        <p className="small muted">
          {total((c) => c.unfetched)} source(s) are cited as leads but were never successfully fetched, usually a
          portal that blocks us. Recorded as a gap, never quoted from.
        </p>
      ) : null}

      {gaps.length ? (
        <>
          <h2 style={{ marginTop: 34 }}>The {total((c) => c.notFound.length)} things we could not find</h2>
          <p className="small muted" style={{ maxWidth: "38em" }}>
            Written down at the moment we gave up on each one, and left there. A portal that blocks us, a fee no
            official page prints, an app named with no store listing, a link off a government host we would not
            send anyone to. This is the column above, in words. It is the part of the product we are least
            embarrassed by.
          </p>
          {/* <details>, so 74 paragraphs are not the first thing on the page and
              no javascript is needed to fold them. */}
          {gaps.map(([journey, notes]) => (
            <details key={journey} style={{ marginBottom: 6 }}>
              <summary>
                {journey} <span className="muted">· {notes.length}</span>
              </summary>
              <ul className="small muted" style={{ marginTop: 6 }}>
                {notes.map((note) => (
                  <li key={note} style={{ marginBottom: 4 }}>
                    {note}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      ) : null}
    </div>
  );
}
