import { NextResponse } from "next/server";
import { authClient, currentUser } from "../caller";

/**
 * GET /api/auth — am I signed in.
 * DELETE /api/auth — sign out.
 *
 * The only two things the page needs to know about identity, and neither
 * returns a token. A tier is a consequence of this answer, never a thing the
 * browser gets to assert. §2.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ signedIn: Boolean(user), email: user?.email });
}

export async function DELETE() {
  const client = await authClient();
  // Local scope: clear this browser's cookies without ending the same person's
  // session on their phone. Signing out of one device is not a security event.
  await client?.auth.signOut({ scope: "local" });
  return NextResponse.json({ signedIn: false });
}
