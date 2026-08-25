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

  // Which ones to put on the front page is decided by the graph, not by a list
  // of ids in this file. The deepest journeys are the ones worth opening, a
  // machine written service is one well sourced step and never belongs here,
  // and a journey that gets deeper next week promotes itself without anybody
  // editing this line.
  const depth = new Map<string, number>();
  for (const e of edges) depth.set(e.from, (depth.get(e.from) ?? 0) + 1);
  const featured = services
    .filter((s) => !s.metadata?.machineExtracted)
    .sort((a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0))
    .slice(0, 6);

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
