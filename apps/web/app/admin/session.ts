import { ADMIN_SESSION_TTL_MS, issueAdminSession, openAdminSession, sameString, verifyPassword } from "@ariane/voice/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Who may read the admin panel.
 *
 * §11. The cryptography is in `@ariane/voice/server` where it is tested without
 * a request; this file is the part that knows about the environment and the
 * cookie jar. Two secrets and a password hash live in the environment, none of
 * them is in Git, and none of them is ever sent to a browser.
 *
 * Deliberately not a layout: `/admin/graph` and `/admin/coverage` are public
 * pages that happen to share this path prefix, so the gate is a call each
 * private page makes rather than a wrapper that would silently swallow them.
 */

const COOKIE = "ariane_admin";

const env = (name: string): string => process.env[name] ?? "";

/** True when this deployment has been given admin credentials at all. */
export const adminConfigured = (): boolean =>
  Boolean(env("ADMIN_USERNAME") && env("ADMIN_PASSWORD_HASH") && env("ADMIN_SESSION_SECRET"));

/**
 * Check a submitted username and password.
 *
 * Both halves are always evaluated — no early return on a wrong username — so
 * the time this takes says nothing about which half was wrong. §11.
 */
export function checkCredentials(username: string, password: string): boolean {
  const nameOk = sameString(username, env("ADMIN_USERNAME"));
  const passOk = verifyPassword(password, env("ADMIN_PASSWORD_HASH"));
  return nameOk && passOk;
}

export async function startAdminSession(username: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, issueAdminSession(username, env("ADMIN_SESSION_SECRET")), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // §11. Strict, not lax: nothing arriving from another site should carry it.
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in operator, or undefined. Safe to call from anywhere. */
export async function adminUser(): Promise<string | undefined> {
  if (!adminConfigured()) return undefined;
  const jar = await cookies();
  const username = openAdminSession(jar.get(COOKIE)?.value, env("ADMIN_SESSION_SECRET"));
  // Re-checked against the environment, so revoking an operator is an env
  // change rather than a hunt for cookies already issued.
  return username && sameString(username, env("ADMIN_USERNAME")) ? username : undefined;
}

/**
 * The gate. Every private admin page calls this first, and so does every admin
 * API route — §11 is explicit that hiding the UI is not the control.
 */
export async function requireAdmin(): Promise<string> {
  const user = await adminUser();
  if (!user) redirect("/admin/login");
  return user;
}
