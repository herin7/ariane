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
    <div className="catalog-grid">
      {items.map((s, index) => (
        <Link key={s.id} href={`/journey?goal=${encodeURIComponent(s.id)}`} className="catalog-link">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <b>{s.name}</b>
          <i aria-hidden>↗</i>
        </Link>
      ))}
    </div>
  );

  return (
    <div className="catalogue-page">
      <div className="page-eyebrow"><Link href="/">Home</Link><span>/</span> Service catalogue</div>
      <div className="catalogue-hero" data-reveal>
        <p className="section-kicker">The evidence library</p>
        <h1>Everything Ariane<br /><span className="signal-text">has mapped.</span></h1>
        <p className="lede">
          Gujarat state and district services, plus the central services a Gujarat citizen actually has
          to touch. Every instruction inside links back to its source.
        </p>
      </div>

      <section className="catalog-section" data-reveal>
        <div className="catalog-heading">
          <div><p className="section-kicker">Human verified</p><h2>Read by a person</h2></div>
          <p>Government pages opened, read and translated into deep paths with prerequisites, documents and questions.</p>
        </div>
        {list(read)}
      </section>

      <section className="catalog-section" data-reveal>
        <div className="catalog-heading">
          <div><p className="section-kicker">Quote checked</p><h2>Read by a machine</h2></div>
          <p>Extracted from official pages and checked word for word. Open the source before relying on one.</p>
        </div>
        {list(found)}
      </section>
    </div>
  );
}
