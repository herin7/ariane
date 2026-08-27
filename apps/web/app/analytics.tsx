"use client";

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Counting, twice, on purpose.
 *
 * Vercel Analytics gets the web vitals and the page views it is good at.
 * `app_events` gets Ariane's own funnel, because §16 says the admin panel must
 * render without a vendor API key and because a search that turns into a
 * journey is a product question no page-view counter can answer.
 *
 * §15, and the whole reason this is a client component rather than two tags in
 * the layout: `beforeSend` drops anything under `/admin`. An operator reading
 * the dashboard is not traffic, and the paths of an admin panel are not
 * something to hand to a third party. The server drops them again in
 * `/api/events`, so this is the polite half of a rule enforced on both sides.
 */

const isAdmin = (url: string): boolean => {
  try {
    return new URL(url, "http://x").pathname.startsWith("/admin");
  } catch {
    return url.startsWith("/admin");
  }
};

export function Telemetry() {
  const pathname = usePathname();

  // One row per page, first party. Fire and forget: a failed beacon must never
  // be visible to the person reading the page.
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    track("page_view", { path: pathname });
  }, [pathname]);

  return (
    <>
      <Analytics beforeSend={(event) => (isAdmin(event.url) ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isAdmin(event.url) ? null : event)} />
    </>
  );
}

/**
 * Record one thing a person did.
 *
 * The allowlist and the metadata rules live on the server, so this is free to
 * be a one-liner: anything it sends that §10 does not permit is dropped at the
 * route rather than trusted. Never pass anything a citizen typed.
 */
export function track(
  event: string,
  body: {
    path?: string;
    serviceId?: string;
    journeyId?: string;
    metadata?: Record<string, string | number | boolean>;
  } = {},
): void {
  if (typeof window === "undefined") return;
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, path: body.path ?? window.location.pathname, ...body }),
    keepalive: true,
  }).catch(() => {
    // Analytics that can break a page is analytics that will.
  });
}
