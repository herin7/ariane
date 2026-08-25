import { loadLiveGraph } from "@ariane/core/server";
import Link from "next/link";
import { Search } from "./search";

// Government facts live in the database, so this page is re-rendered rather
// than frozen at build time. A minute is close enough to live for a list of
// service names and keeps the page a static file the rest of the time.
export const revalidate = 60;

export default async function Home() {
  const { nodes, edges } = await loadLiveGraph();
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
    <>
      {/* §28. The one sentence that has to land before anything else does. */}
      <h1 className="rise">
        Government shouldn&rsquo;t
        <br />
        feel this hard.
      </h1>
      <p className="lede rise">
        Tell us what you need to get done. We work out the order, the documents, the website and the
        office, and we show you the government page every single answer came from.
      </p>

      <Search />

      <h2>Or start with one of these</h2>
      <div className="stack">
        {featured.map((service) => (
          <Link key={service.id} href={`/journey?goal=${encodeURIComponent(service.id)}`} className="card rise">
            <h3>{service.name}</h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {service.description}
            </p>
          </Link>
        ))}
      </div>

      <p className="small" style={{ marginTop: 20 }}>
        <Link href="/browse">Or read the whole catalogue</Link>{" "}
        <span className="faint">Gujarat state, Gujarat district, and the central ones you cannot avoid.</span>
      </p>

      <p className="small faint" style={{ marginTop: 40 }}>
        <Link href="/admin/graph" className="muted">
          See the machinery
        </Link>
        {"  ·  "}
        <Link href="/admin/coverage" className="muted">
          See what we do not know yet
        </Link>
      </p>
    </>
  );
}
