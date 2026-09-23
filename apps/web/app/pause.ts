import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { adminDb } from "./admin/db";
import { interpretPauseRead, type PauseReadError, type PauseSetting } from "./pause-value";

export type { PauseSetting };

/**
 * The credits pause, as a row an admin can change.
 *
 * There is no feature-flag table anywhere else, so this is the one switch:
 * `ariane_settings.service_paused` in the operations schema. The public pages
 * read it. The admin panel writes it. Nothing about the sentence is stored
 * here, so the notice cannot drift into a reason nobody decided.
 *
 * Missing row, missing table, and no database at all all mean the notice
 * stays up. Clearing it is an explicit write. Re-applying the schema does
 * not undo that write.
 */

const PAUSE_KEY = "service_paused";
const TAG = "service-paused";

async function readPauseUncached(): Promise<PauseSetting> {
  const db = adminDb();
  if (!db) return interpretPauseRead({ configured: false });

  const { data, error } = await db.from("ariane_settings").select("value").eq("key", PAUSE_KEY).maybeSingle();
  return interpretPauseRead({
    configured: true,
    error: (error as PauseReadError | null) ?? null,
    value: data ? (data as { value: unknown }).value : undefined,
  });
}

const readPauseCached = unstable_cache(readPauseUncached, [TAG], { revalidate: 30, tags: [TAG] });

/** What a public page should do. Cached, and dropped the moment an admin saves. */
export async function servicePaused(): Promise<boolean> {
  return (await readPauseCached()).paused;
}

/** The admin panel. Uncached, so the switch matches the row just written. */
export function readPauseSetting(): Promise<PauseSetting> {
  return readPauseUncached();
}

export async function setServicePaused(paused: boolean, updatedBy: string): Promise<"ok" | "no-database" | "not-saved"> {
  const db = adminDb();
  if (!db) return "no-database";

  const { error } = await db.from("ariane_settings").upsert(
    {
      key: PAUSE_KEY,
      value: { paused },
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "key" },
  );
  if (error) return "not-saved";

  revalidateTag(TAG);
  revalidatePath("/", "layout");
  return "ok";
}
