import { loadLiveGraph } from "@ariane/core/server";
import Link from "next/link";
import { Search } from "./search";

// Government facts live in the database, so this page is re-rendered rather
// than frozen at build time. A minute is close enough to live for a list of
// service names and keeps the page a static file the rest of the time.
export const revalidate = 60;

export default async function Home() {
  const { nodes } = await loadLiveGraph();
  const services = nodes.filter((n) => n.type === "SERVICE");

  return (
    <>
      <h1>What do you need to get done?</h1>
      <p className="sub">
        Describe it the way you would say it out loud. We work out the order, the documents, the website
        and the office, and we show you where every answer came from.
      </p>

      <Search />

      <h2>Or start from one of these</h2>
      {services.map((service) => (
        <Link key={service.id} href={`/journey?goal=${encodeURIComponent(service.id)}`} style={{ textDecoration: "none" }}>
          <div className="card">
            <h3>{service.name}</h3>
            {service.officialName && service.officialName !== service.name ? (
              <p className="muted small">Officially: {service.officialName}</p>
            ) : null}
            <p className="muted small" style={{ margin: 0 }}>{service.description}</p>
          </div>
        </Link>
      ))}

      <p className="small muted">
        Want to see the machinery? <Link href="/admin/graph">Open the graph explorer</Link>. Same compile call,
        drawn instead of listed. Want to see what we do not know yet? <Link href="/admin/coverage">Coverage</Link>.
      </p>
    </>
  );
}
