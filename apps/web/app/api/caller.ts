import { createServerClient } from "@supabase/ssr";
import { ANON_COOKIE, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, ipHash, issueGuest, newAnonId, readGuest } from "@ariane/voice/server";
import type { Tier } from "@ariane/voice";
import { cookies } from "next/headers";

/**
 * Who is asking, resolved once, server side.
 *
 * Every limit, every quota and every ceiling in this deployment is charged
 * against what this file returns, so it is the one place identity is decided
 * and there is deliberately no way to pass any of it in. A request body cannot
 * say which tier it is, cannot supply an ip hash and cannot name a user: those
 * come from a proxy header Vercel sets, a cookie we signed, and a Supabase
 * session cookie Supabase signed. §2, §6.
 *
 * Not a route. Only `route.ts` becomes an endpoint.
 */

/** Cookies are only writable inside a route handler, hence the two flavours. */
type Jar = Awaited<ReturnType<typeof cookies>>;

export interface Caller {
  /** HMAC of the address, or undefined when no header could be trusted. */
  ipHash?: string;
  /** Signed cookie id for an un-logged-in browser. */
  guestId?: string;
  /** Supabase auth user id, when a verified session cookie was present. */
  authUserId?: string;
  email?: string;
  tier: Tier;
  /** Meaningless stable id, for counting visitors in `app_events`. */
  anonId?: string;
}

const secret = (name: string): string => process.env[name] ?? "";

/**
 * The Supabase project, by whichever pair of names this deployment uses.
 *
 * `NEXT_PUBLIC_*` first because that is what §22 documents and what a browser
 * client would need; the older server-side names are honoured so an existing
 * deployment keeps working without a redeploy. The secret key is deliberately
 * not in this chain — auth runs on the publishable key, and reaching for a
 * service role here would hand every signed-in user the whole database.
 */
function authProject(): { url: string; key: string } | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : undefined;
}

/**
 * A Supabase client whose session lives in this request's cookies.
 *
 * The tokens never reach the browser as JavaScript state: they are HttpOnly
 * cookies Supabase's own helper writes, and every call that needs them happens
 * on this side. That is why there is no browser Supabase client anywhere in
 * this app. §8.
 */
export async function authClient(jar?: Jar) {
  const project = authProject();
  if (!project) return undefined;
  const store = jar ?? (await cookies());

  return createServerClient(project.url, project.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where the jar is read only. The
          // refreshed token is simply not persisted this time round, which the
          // next route handler fixes. Throwing here would blank the page.
        }
      },
    },
  });
}

/** The signed-in user, or undefined. Verified against Supabase, not decoded locally. */
export async function currentUser(jar?: Jar): Promise<{ id: string; email?: string } | undefined> {
  const client = await authClient(jar);
  if (!client) return undefined;
  // `getUser`, never `getSession`: the session cookie is a thing the browser
  // holds and could have edited, and only the round trip actually validates it.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return undefined;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

/**
 * Resolve the caller, issuing the guest and analytics cookies if they are
 * missing. Safe to call on any request: it never creates a session, never
 * counts anything and never writes to the database.
 */
export async function caller(request: Request): Promise<Caller> {
  const jar = await cookies();
  const rate = secret("RATE_LIMIT_SECRET");

  const user = await currentUser(jar);
  const hashed = rate ? ipHash(request.headers, rate) : undefined;

  let guestId: string | undefined;
  if (rate) {
    guestId = readGuest(jar.get(GUEST_COOKIE)?.value, rate);
    if (!guestId) {
      // A tampered cookie is replaced rather than rejected. The quota it was
      // trying to escape is charged against the address as well, so forging one
      // buys nothing and refusing the request would only confuse an honest
      // browser that lost its cookie.
      const issued = issueGuest(rate);
      guestId = readGuest(issued, rate);
      set(jar, GUEST_COOKIE, issued, GUEST_COOKIE_MAX_AGE);
    }
  }

  let anonId = jar.get(ANON_COOKIE)?.value;
  if (!anonId) {
    anonId = newAnonId();
    set(jar, ANON_COOKIE, anonId, GUEST_COOKIE_MAX_AGE);
  }

  return {
    ipHash: hashed,
    guestId,
    authUserId: user?.id,
    email: user?.email,
    // The whole of §2 in one line. Signed in or not; there is no third source.
    tier: user ? "AUTHENTICATED" : "GUEST",
    anonId,
  };
}

function set(jar: Jar, name: string, value: string, maxAge: number): void {
  try {
    jar.set(name, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  } catch {
    // Read-only jar (Server Component). The caller still gets a usable id for
    // this request; the next route handler will persist one.
  }
}
