import { ADMIN_LOCKOUT_MS, RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { adminConfigured, checkCredentials, endAdminSession, startAdminSession } from "../../../admin/session";
import { caller } from "../../caller";
import { ops } from "../../ops";

/**
 * POST /api/admin/login — the only way into the admin panel.
 * DELETE — sign out.
 *
 * §6, §11. Five wrong guesses from one address and that address waits fifteen
 * minutes, counted in Postgres so it holds across Vercel instances. The reply
 * is the same sentence whichever half was wrong, so this cannot be used to
 * discover the username.
 */
export const dynamic = "force-dynamic";

const DENIED = { error: "That username and password did not match." };

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "Admin is not configured on this deployment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(DENIED, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string" || username.length > 200 || password.length > 400) {
    return NextResponse.json(DENIED, { status: 400 });
  }

  const who = await caller(request);
  const store = ops();
  const subject = who.ipHash ?? "unknown";

  const cooling = await store.cooldown(`admin:${subject}`);
  if (cooling) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const verdict = await store.rateLimit(
    `admin:login:${subject}`,
    RATE_LIMITS.adminLogin.windowSeconds,
    RATE_LIMITS.adminLogin.max,
  );

  if (!checkCredentials(username, password)) {
    // The counter above is incremented by every attempt; only a failure turns a
    // spent counter into a wait, so a busy day of correct logins is not a
    // lockout. §6.
    if (!verdict.allowed) await store.setCooldown(`admin:${subject}`, Date.now() + ADMIN_LOCKOUT_MS, "admin-login");
    await store
      .recordSecurityEvent({
        ipHash: who.ipHash,
        category: "admin-login-failed",
        severity: verdict.allowed ? "LOW" : "HIGH",
        actionTaken: verdict.allowed ? "refused" : "cooldown",
      })
      .catch(() => {
        // Telemetry must not decide whether a login is refused.
      });
    return NextResponse.json(DENIED, { status: 401 });
  }

  await startAdminSession(username);
  return NextResponse.json({ signedIn: true });
}

export async function DELETE() {
  await endAdminSession();
  return NextResponse.json({ signedIn: false });
}
