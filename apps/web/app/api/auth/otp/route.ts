import { RATE_LIMITS } from "@ariane/voice";
import { NextResponse } from "next/server";
import { authClient, caller } from "../../caller";
import { ops } from "../../ops";

/**
 * POST /api/auth/otp — send a one time code to an email address.
 *
 * The whole of Ariane's login, half of it. No password to forget, no password
 * to leak, no password reset flow to get wrong. §2 asked for the simplest thing
 * that works and this is it.
 *
 * A code rather than a magic link on purpose: a link needs a redirect allowlist
 * configured per deployment and breaks when somebody opens their mail on a
 * different device. A few digits typed into the page they are already on works
 * from a phone, a shared computer and a train.
 *
 * How many digits is a Supabase project setting, so nothing here counts them.
 * `verify` accepts six to ten.
 */
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const client = await authClient();
  if (!client) return NextResponse.json({ error: "Sign in is not configured on this deployment" }, { status: 503 });

  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    email = String(body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That does not look like an email address" }, { status: 400 });
  }

  /**
   * Limited per address *and* per email, because the two abuses are different:
   * one machine enumerating a thousand mailboxes, and one mailbox being buried
   * under codes it did not ask for. Either alone leaves the other open.
   */
  const store = ops();
  const who = await caller(request);
  const subjects = [who.ipHash ? `ip:${who.ipHash}` : undefined, `email:${email}`].filter(Boolean) as string[];
  for (const subject of subjects) {
    const verdict = await store.rateLimit(
      `auth:otp:${subject}`,
      RATE_LIMITS.magicLink.windowSeconds,
      RATE_LIMITS.magicLink.max,
    );
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "Too many codes requested. Please wait a few minutes.", retryAt: verdict.resetAt },
        { status: 429 },
      );
    }
  }

  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    // The message goes to the log, not to the browser. Supabase's own text
    // distinguishes "no such user" from "rate limited", and telling a stranger
    // which is which turns this endpoint into an account enumerator.
    console.warn("could not send a sign-in code", error.message);
  }

  // Always the same answer, sent or not. Same reason.
  return NextResponse.json({ sent: true });
}
