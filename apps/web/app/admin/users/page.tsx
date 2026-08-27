import type { Metadata } from "next";
import Link from "next/link";
import { page } from "../db";
import { requireAdmin } from "../session";
import { Shell, Table, secs, when } from "../shell";

/**
 * /admin/users — everyone who has signed in.
 *
 * §12, and the constraint that shapes it: an IP HASH is what an operator sees.
 * There is no column of addresses to show because none is stored — the hash is
 * keyed by a secret, so it identifies a returning visitor without being
 * reversible into a person's address.
 */

export const metadata: Metadata = { title: "Users · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Profile {
  auth_user_id: string;
  email: string | null;
  first_seen_at: string;
  last_seen_at: string;
  voice_ms: number;
  login_count: number;
}

export default async function Users({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireAdmin();
  const at = Number((await searchParams).page ?? 0) || 0;

  const users = await page<Profile>("ariane_profiles", { page: at, order: "last_seen_at" });

  return (
    <Shell here="/admin/users" user={user}>
      <p className="small faint" style={{ margin: 0 }}>
        Signed-in citizens. Guests are not people here — they are a signed cookie and a hashed address, and they appear
        under Conversations.
      </p>

      <Table
        page={users}
        href={(next) => `/admin/users?page=${next}`}
        empty="Nobody has signed in yet."
        columns={[
          ["Email", (row) => row.email ?? "—"],
          ["Last seen", (row) => when(row.last_seen_at)],
          ["First seen", (row) => when(row.first_seen_at)],
          ["Sign-ins", (row) => row.login_count],
          ["Voice used", (row) => secs(row.voice_ms)],
          [
            "Calls",
            (row) => <Link href={`/admin/conversations?user=${row.auth_user_id}`}>view</Link>,
          ],
        ]}
      />
    </Shell>
  );
}
