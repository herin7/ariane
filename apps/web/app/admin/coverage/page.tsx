import { coverage } from "@ariane/core/server";
import Link from "next/link";

export const metadata = { title: "Coverage" };

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
 */

const num = { textAlign: "right" as const, padding: "4px 10px", fontVariantNumeric: "tabular-nums" as const };
const head = { ...num, borderBottom: "1px solid #24272b", color: "#8a8f96", fontWeight: 400 };

export default function CoveragePage() {
  const all = coverage();
  const total = (pick: (c: (typeof all)[number]) => number) => all.reduce((sum, c) => sum + pick(c), 0);
  const checked = total((c) => c.byStatus.VERIFIED ?? 0);
  const machine = total((c) => c.byStatus.EXTRACTED ?? 0);
  const unsourced = all.flatMap((c) => c.unsourced);
  const gaps = all.filter((c) => c.notFound.length).map((c) => [c.journey, c.notFound] as const);

  return (
    <>
      <p className="small"><Link href="/">Back</Link> · <Link href="/admin/graph">Graph explorer</Link></p>
      <h1>Coverage</h1>
      <p className="sub">
        {total((c) => c.services)} services across {all.length} journeys. {checked} citation(s) a person read and
        confirmed, {machine} a machine extracted and proved verbatim against the page. Neither number means the
        page is still current, only that the quote is really on it.
      </p>

      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>journey</th>
            <th style={head}>services</th>
            <th style={head}>documents</th>
            <th style={head}>offices</th>
            <th style={head}>helplines</th>
            <th style={head}>edges</th>
            <th style={head}>checked</th>
            <th style={head}>extracted</th>
            <th style={head}>conflicting</th>
            <th style={head}>unsourced</th>
            <th style={head}>not found</th>
          </tr>
        </thead>
        <tbody>
          {all.map((c) => (
            <tr key={c.journey}>
              <td style={{ ...num, textAlign: "left" }}>{c.journey}</td>
              <td style={num}>{c.services}</td>
              <td style={num}>{c.documents}</td>
              <td style={num}>{c.offices}</td>
              <td style={num}>{c.helplines}</td>
              <td style={num}>{c.edges}</td>
              <td style={num}>{c.byStatus.VERIFIED ?? 0}</td>
              <td style={num}>{c.byStatus.EXTRACTED ?? 0}</td>
              <td style={{ ...num, color: c.byStatus.CONFLICTING ? "#d2a63f" : undefined }}>{c.byStatus.CONFLICTING ?? 0}</td>
              <td style={{ ...num, color: c.unsourced.length ? "#c96b6b" : undefined }}>{c.unsourced.length}</td>
              <td style={num}>{c.notFound.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="small muted" style={{ marginTop: 16 }}>
        <b>conflicting</b> is two sources that disagree, both kept, neither picked. <b>not found</b> is something
        we looked for and could not find, written down rather than guessed. Both are wanted. <b>unsourced</b> is
        the only column that is a fault: a requirement we would put in front of a citizen with nothing to show
        for it. {unsourced.length === 0 ? "There are none." : `There are ${unsourced.length}.`}
      </p>
      {gaps.length ? (
        <>
          <h2 style={{ marginTop: 28 }}>The {total((c) => c.notFound.length)} things we could not find</h2>
          <p className="sub">
            Written down at the moment we gave up on each one, and left there. A portal that blocks
            us, a fee no official page prints, an app named with no store listing, a link off a
            government host we would not send anyone to. This is the column above, in words. It is
            the part of the product we are least embarrassed by.
          </p>
          {/* <details>, so 74 paragraphs are not the first thing on the page and
              no javascript is needed to fold them. */}
          {gaps.map(([journey, notes]) => (
            <details key={journey} style={{ marginBottom: 6 }}>
              <summary style={{ cursor: "pointer" }}>
                {journey} <span className="muted">· {notes.length}</span>
              </summary>
              <ul className="small muted" style={{ marginTop: 6 }}>
                {notes.map((note) => (
                  <li key={note} style={{ marginBottom: 4 }}>{note}</li>
                ))}
              </ul>
            </details>
          ))}
        </>
      ) : null}

      {total((c) => c.unfetched) > 0 ? (
        <p className="small muted">
          {total((c) => c.unfetched)} source(s) are cited as leads but were never successfully fetched, usually a
          portal that blocks us. Recorded as a gap, never quoted from.
        </p>
      ) : null}
    </>
  );
}
