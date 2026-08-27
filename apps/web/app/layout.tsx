import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Telemetry } from "./analytics";
import { MotionObserver } from "./motion";

export const metadata: Metadata = {
  title: { default: "Ariane", template: "%s · Ariane" },
  description: "One verified path through Gujarat government services.",
};

export const viewport: Viewport = {
  themeColor: "#faf9f6",
  // Zooming is how a lot of people read a government page. §22.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Elms+Sans:ital,wght@0,100..900;1,100..900&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Stack+Sans+Notch:wght@200..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <MotionObserver />
        <Telemetry />
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" aria-label="Ariane, home" className="wordmark">
              <span className="brand-mark" aria-hidden>
                <svg width="18" height="20" viewBox="0 0 18 20" fill="none">
                  <path d="M9 2v4M9 6c-5 0-5 4 0 4s5 4 0 4M9 14v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              Ariane
            </Link>

            <nav className="site-nav" aria-label="Main navigation">
              <Link href="/browse">Services</Link>
              <Link href="/voice">Talk</Link>
              <Link href="/admin/graph">How it works</Link>
              <Link href="/admin/coverage">Coverage</Link>
            </nav>

            <Link href="/#start" className="nav-cta">
              <span>Find my path</span>
              <span className="nav-cta-icon" aria-hidden>↗</span>
            </Link>

            {/* Below 700px the pill swallows the links, so it unfolds into them
                instead. A <details> is the whole disclosure: open state, keyboard
                and screen-reader semantics, all without hydrating anything. */}
            <details className="nav-menu">
              <summary aria-label="Menu"><span className="nav-menu-bars" aria-hidden /></summary>
              <div className="nav-menu-panel">
                <Link href="/browse">Services</Link>
                <Link href="/voice">Talk</Link>
                <Link href="/admin/graph">How it works</Link>
                <Link href="/admin/coverage">Coverage</Link>
              </div>
            </details>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-brand">
              <Link href="/" className="wordmark" aria-label="Ariane, home">
                <span className="brand-mark small-mark" aria-hidden>⌁</span>
                Ariane
              </Link>
              <p>Government digitised its departments.<br />Ariane builds the map between them.</p>
            </div>
            <div className="footer-links">
              <div><b>Explore</b><Link href="/">Start a journey</Link><Link href="/browse">All services</Link></div>
              <div><b>Trust</b><Link href="/admin/coverage">What we know</Link><Link href="/admin/graph">See the graph</Link></div>
              <div><b>Scope</b><span>Gujarat, India</span><span>Official sources linked</span></div>
            </div>
          </div>
          <div className="footer-base">Ariane is independent and is not an official government publication.</div>
        </footer>
      </body>
    </html>
  );
}
