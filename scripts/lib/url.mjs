/**
 * One answer to "is this the same page".
 *
 * Lived in fetch-ledger.mjs, which does its work at import time and so cannot
 * be imported. Two copies of this function is two definitions of identity, and
 * the day they disagree is the day we pay to fetch a page we already have.
 */

/**
 * Trailing slashes and a `?utm_source=` do not make it a different page, and
 * treating them as different is exactly how you pay twice. Fragments never do.
 */
export function normalise(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(p)) u.searchParams.delete(p);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

/** Host without `www.`, lowercased. The unit the domain registry is keyed by. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
