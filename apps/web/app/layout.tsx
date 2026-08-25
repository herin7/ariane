import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariane",
  description: "Government digitised its departments. This is the map between them.",
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  // Zooming is how a lot of people read a government page. §22.
  maximumScale: 5,
};

/**
 * §17. One wordmark, no navigation.
 *
 * There is nothing to navigate to. You say what you need, you read the path.
 * Every link that used to live in a nav bar is a link at the bottom of the
 * page it belongs to, which is where somebody looks for it anyway.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "18px 20px 0",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Link
            href="/"
            aria-label="Ariane, home"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "var(--ink)",
              textDecoration: "none",
              fontWeight: 640,
              letterSpacing: "-0.02em",
            }}
          >
            {/* The thread, which is the whole brand and also the name: the one
                Ariadne handed over so somebody could walk out of the labyrinth
                he was already standing in. §8. */}
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none" aria-hidden>
              <path
                d="M8 1v4M8 5c-4 0-4 4 0 4s4 4 0 4M8 13v4"
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Ariane
          </Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
