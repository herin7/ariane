import { loadGraph } from "@ariane/core";
import Link from "next/link";
import { Search } from "./search";

export default function Home() {
  const services = loadGraph().nodes.filter((n) => n.type === "SERVICE");

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
    </>
  );
}
