/**
 * How a settings read becomes the credits notice.
 *
 * Only an explicit `false` hides it. A missing row, a row this code does not
 * understand, a missing table, and no database at all all leave the notice
 * up. Clearing it has to be a write that says so, not the absence of one.
 */

export interface PauseReadError {
  code?: string;
  message?: string;
}

export type PauseSetting =
  | { paused: boolean; writable: true }
  | { paused: true; writable: false; reason: "no-database" | "not-installed" | "unavailable" };

export function pausedFromValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  return (value as { paused?: unknown }).paused !== false;
}

function missingTable(error: PauseReadError): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || (error.message ?? "").includes("ariane_settings");
}

export function interpretPauseRead(
  read:
    | { configured: false }
    | { configured: true; error: PauseReadError | null; value: unknown | undefined },
): PauseSetting {
  if (!read.configured) return { paused: true, writable: false, reason: "no-database" };
  if (read.error) {
    return { paused: true, writable: false, reason: missingTable(read.error) ? "not-installed" : "unavailable" };
  }
  if (read.value === undefined) return { paused: true, writable: true };
  return { paused: pausedFromValue(read.value), writable: true };
}
