import { createHash } from "node:crypto";
import { redactText } from "../guardrails";
import { SECURITY_COOLDOWN } from "../policy";
import type { OpsStore, SecurityEvent } from "./store";

/**
 * What somebody tried, written down, and what follows from it.
 *
 * The split this file exists to enforce: a *classifier* decides that a sentence
 * looks like an injection attempt. A *policy* decides that three of those in an
 * hour means no voice for a while. The first is a guess about text and can be
 * argued with; the second is arithmetic over rows and cannot. Nothing in
 * `guardrails.ts` ever calls `setCooldown` directly, and that is deliberate.
 *
 * The model has no path here at all. It cannot record an event, cannot read
 * one, cannot clear one and cannot see that one happened.
 */

export type SecurityCategory =
  | "prompt-injection"
  | "secret-probe"
  | "limit-probe"
  | "identity-probe"
  | "cross-user-probe"
  | "output-leak"
  | "tool-denied"
  | "rate-limited"
  | "admin-login-failed"
  | "queue-tamper";

export interface Report {
  sessionId?: string;
  authUserId?: string;
  ipHash?: string;
  category: SecurityCategory;
  severity: SecurityEvent["severity"];
  /** What we did. "refused", "downgraded", "ended-call", "logged". */
  actionTaken: string;
  /** Raw caller text. Redacted here — callers must not pre-truncate it. */
  input?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A stable fingerprint of what was said, without keeping what was said.
 *
 * This is how an operator sees the same scripted probe arriving from thirty
 * addresses: thirty rows, one hash. Normalised first so whitespace and casing
 * do not make one attack look like thirty.
 *
 * Unkeyed on purpose. It fingerprints attack strings, not people, and an
 * operator being able to hash a suspected payload themselves and grep for it is
 * the entire feature.
 */
export function inputHash(text: string): string {
  const normalised = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

export class SecurityLog {
  constructor(private readonly ops: OpsStore) {}

  /**
   * Record it, then decide whether it has happened enough times to matter.
   *
   * The excerpt is redacted here rather than at the call site, so a new caller
   * cannot forget. Both walls are real: this one, and the 300-character check
   * constraint on the column.
   */
  async record(report: Report): Promise<void> {
    const excerpt = report.input ? redactText(report.input, 280) : undefined;

    await this.ops.recordSecurityEvent({
      sessionId: report.sessionId,
      authUserId: report.authUserId,
      ipHash: report.ipHash,
      category: report.category,
      severity: report.severity,
      actionTaken: report.actionTaken,
      safeExcerpt: excerpt,
      inputHash: report.input ? inputHash(report.input) : undefined,
      metadata: report.metadata,
    });

    if (report.severity === "HIGH") await this.escalate(report);
  }

  /**
   * Three HIGH events in an hour and voice closes for that subject.
   *
   * Voice only. Reading Ariane — searching, opening a service, following a
   * journey — is never restricted by this, because the thing being protected is
   * an audio bill and a model context, and because locking somebody out of
   * public government information over a regex match is a worse outcome than
   * the attack.
   */
  private async escalate(report: Report): Promise<void> {
    const subject = report.authUserId
      ? `user:${report.authUserId}`
      : report.ipHash
        ? `ip:${report.ipHash}`
        : undefined;
    if (!subject) return;

    const count = await this.ops.securityCount({
      authUserId: report.authUserId,
      ipHash: report.ipHash,
      severity: "HIGH",
      sinceMs: SECURITY_COOLDOWN.windowMs,
    });
    if (count < SECURITY_COOLDOWN.threshold) return;

    await this.ops.setCooldown(subject, Date.now() + SECURITY_COOLDOWN.durationMs, "repeated-high-severity");
  }
}
