import { loadLiveGraph } from "@ariane/core/server";
import Link from "next/link";

export const revalidate = 60;

export const metadata = { title: "Everything Ariane has read" };

/**
 * The whole catalogue, on its own page.
 *
 * It used to be a `<details>` at the bottom of the home page, which meant every
 * first visit on a phone downloaded 440KB of HTML to render a list nobody had
 * asked to see yet. §23. The landing page now weighs what a landing page should
 * and this page, which you reach on purpose, is allowed to be long.
 */
export default async function Browse() {
  const { nodes } = await loadLiveGraph();
  const services = nodes.filter((n) => n.type === "SERVICE");
  const read = services.filter((s) => !s.metadata?.machineExtracted).sort((a, b) => a.name.localeCompare(b.name));
  const found = services.filter((s) => s.metadata?.machineExtracted).sort((a, b) => a.name.localeCompare(b.name));

  const list = (items: typeof services) => (
    <ul className="small" style={{ columns: "2 14rem", paddingLeft: 18 }}>
      {items.map((s) => (
        <li key={s.id}>
          <Link href={`/journey?goal=${encodeURIComponent(s.id)}`}>{s.name}</Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <Link href="/" className="small muted" style={{ textDecoration: "none" }}>‹ Back</Link>
      <h1 style={{ marginTop: 14 }}>Everything Ariane has read</h1>
      <p className="lede">
        Gujarat state services, Gujarat district services, and the central ones a Gujarat citizen
        actually has to touch. Nothing here is a guess: every line inside is quoted from a government
        page, and the quote was checked against that page before it was allowed in.
      </p>

      <h2>Read by a person</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Somebody opened the government pages behind these and typed out what they said. These are the
        deep ones: real prerequisites, documents you can tick off, questions that change the path.
      </p>
      {list(read)}

      <h2>Read by a machine</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Found by the pipeline and never checked by a person. Every quote is verbatim off the page it
        links to, but most of these compile to a single well sourced step rather than a journey. Open
        the source before you rely on one.
      </p>
      {list(found)}
    </>
  );
}
