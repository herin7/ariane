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

  // Two piles, because they are not the same thing and one flat list of 217
  // said they were. 28 of these were researched by a person and compile into
  // real multi step journeys; 189 were quoted off a page by a machine and
  // mostly compile into one well sourced step. Listing them together in graph
  // order put a machine written entry first and buried the driving licence.
  const read = services.filter((s) => !s.metadata?.machineExtracted);
  const found = services
    .filter((s) => s.metadata?.machineExtracted)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>What do you need to get done?</h1>
      <p className="sub">
        Describe it the way you would say it out loud. We work out the order, the documents, the website
        and the office, and we show you where every answer came from.
      </p>

      <Search />

      <h2>Or start from one of these</h2>
      <p className="sub">
        A person read the government pages behind these {read.length} and typed out what they said.
        They are the deep ones: real prerequisites, documents you can tick off, questions that change
        the path.
      </p>
      {read.map((service) => (
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

      <h2>Another {found.length} nobody has read</h2>
      <p className="sub">
        These were found by the pipeline. Every line on them is quoted from a government page and the
        quote was checked against that page before it was allowed in, but no person has looked. Most
        are a single well sourced step rather than a journey. Open the source before you rely on one.
      </p>
      {/* A plain list, not 189 more cards. A card is a recommendation. */}
      <ul className="small" style={{ columns: "2 16rem" }}>
        {found.map((service) => (
          <li key={service.id}>
            <Link href={`/journey?goal=${encodeURIComponent(service.id)}`}>{service.name}</Link>
          </li>
        ))}
      </ul>

      <p className="small muted">
        Want to see the machinery? <Link href="/admin/graph">Open the graph explorer</Link>. Same compile call,
        drawn instead of listed. Want to see what we do not know yet? <Link href="/admin/coverage">Coverage</Link>.
      </p>
    </>
  );
}
