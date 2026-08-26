import { graph } from "./graph";
import Link from "next/link";
import { Search } from "./search";

// Government facts live in the database, so this page is re-rendered rather
// than frozen at build time. A minute is close enough to live for a list of
// service names and keeps the page a static file the rest of the time.
export const revalidate = 60;

export default async function Home() {
  const { nodes, edges, sources } = await graph();
  const services = nodes.filter((n) => n.type === "SERVICE");

  // The three the product is demonstrated on go first, then the graph decides
  // the rest by how many things it can say about a service.
  //
  // These three ids are the only editorial decision on this page. No name, no
  // fee, no document and no rule is written here: every id is looked up in the
  // graph and quietly disappears from the page if it ever stops existing. Two
  // derived rankings were tried first and neither found them. Counting direct
  // edges ranked driving licence eighth. Counting everything reachable was
  // worse, because the scholarship services all lead into the same portal, so
  // it filled the page with three near identical scholarship cards.
  //
  // Varshai is machine written and still belongs here: it is how a Gujarati
  // family gets a death in it recognised, and the step cards say plainly where
  // each line came from.
  const HEROES = ["service:nsp_scholarship", "service:driving_licence", "service:varshai"];

  const degree = new Map<string, number>();
  for (const e of edges) degree.set(e.from, (degree.get(e.from) ?? 0) + 1);

  const byId = new Map(services.map((s) => [s.id, s]));
  const featured = [
    ...HEROES.map((id) => byId.get(id)).filter((s) => s !== undefined),
    ...services
      .filter((s) => !HEROES.includes(s.id) && !s.metadata?.machineExtracted)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
  ].slice(0, 6);

  return (
    <div className="home-page">
      <section className="hero" data-reveal>
        <div className="hero-copy-block">
          <p className="eyebrow"><span className="eyebrow-line" /> A source-backed map for Gujarat</p>
          <h1>
            Find the thread<br />
            <span className="signal-text">through government.</span>
          </h1>
          <p className="hero-copy">
            Say what you need in your own words. Ariane joins the documents, portals, offices and official proof
            into one route you can follow.
          </p>

          <Search />

          <div className="proof-strip" aria-label="Ariane coverage">
            <span><b>{services.length.toLocaleString()}</b> services</span>
            <span><b>{nodes.length.toLocaleString()}</b> connected facts</span>
            <span><b>{sources.length.toLocaleString()}</b> official sources</span>
          </div>
        </div>

        <div className="ariane-map" aria-label="Ariane joins a citizen need into one verified route">
          <div className="map-header">
            <div><span className="map-live" /> Your route</div>
            <span>built from official sources</span>
          </div>
          <div className="map-path">
            <div className="map-step">
              <span className="map-knot">1</span>
              <div><small>Start</small><b>What you are trying to do</b></div>
            </div>
            <div className="map-step">
              <span className="map-knot">2</span>
              <div><small>Prepare</small><b>Documents and prerequisites</b></div>
              <span className="map-chip">only what applies</span>
            </div>
            <div className="map-step">
              <span className="map-knot">3</span>
              <div><small>Apply</small><b>The right portal or office</b></div>
            </div>
            <div className="map-step">
              <span className="map-knot">4</span>
              <div><small>If it stalls</small><b>Tracking and escalation</b></div>
              <span className="map-chip proof">source linked</span>
            </div>
          </div>
          <div className="map-footer"><span>⌁</span> One need, joined across departments.</div>
        </div>
      </section>

      <section className="route-section" data-reveal>
        <div className="section-intro">
          <p className="section-kicker">The route, not the runaround</p>
          <h2>One request. One path you can actually follow.</h2>
          <p>Ariane does the cross-department work before you reach the counter.</p>
        </div>

        <div className="route-panel">
          <div className="route-grid" aria-label="How Ariane builds a citizen journey">
            <div className="route-stage active">
              <span className="route-number">01</span>
              <div><b>Say what you need</b><p>Use your own words. Ariane finds the service without inventing one.</p></div>
            </div>
            <div className="route-stage">
              <span className="route-number">02</span>
              <div><b>Answer what matters</b><p>Only questions that change your eligibility or route are asked.</p></div>
            </div>
            <div className="route-stage">
              <span className="route-number">03</span>
              <div><b>Follow the proof</b><p>Documents, portals, offices and escalation—each tied to a source.</p></div>
            </div>
          </div>
          <div className="route-note">
            <span className="route-pulse" />
            <p><b>The graph decides.</b><br />If a requirement is not supported by the map and its evidence, Ariane does not say it.</p>
          </div>
        </div>
      </section>

      <section className="featured-section" data-reveal>
        <div className="section-intro row-between">
          <div>
            <p className="section-kicker">Mapped journeys</p>
            <h2>Start somewhere familiar.</h2>
          </div>
          <Link href="/browse" className="text-link">Browse all services <span>→</span></Link>
        </div>
        <div className="service-grid">
          {featured.map((service, index) => (
            <Link key={service.id} href={`/journey?goal=${encodeURIComponent(service.id)}`} className="service-card rise">
              <span className="service-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{service.name}</h3>
                <p>{service.description}</p>
              </div>
              <span className="service-arrow" aria-hidden>↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="trust-section" data-reveal>
        <div className="trust-copy">
          <p className="section-kicker">Honest by construction</p>
          <h2>If we cannot verify it,<br />we say so.</h2>
          <p>No plausible guesses dressed up as instructions. Conflicting sources stay conflicting, and missing facts stay visible.</p>
          <Link href="/admin/coverage" className="secondary-link">See what Ariane does not know yet</Link>
        </div>
        <div className="trust-list">
          <div><span>01</span><p><b>Every claim carries proof.</b> Open the exact government page and quote behind a step.</p></div>
          <div><span>02</span><p><b>The model cannot make policy.</b> It may understand your request; the graph decides the route.</p></div>
          <div><span>03</span><p><b>Uncertainty stays visible.</b> Machine-extracted, conflicting and missing information are never flattened.</p></div>
        </div>
      </section>
    </div>
  );
}
