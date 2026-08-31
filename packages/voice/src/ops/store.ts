import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The operational half of the database: capacity, queue, limits, security,
 * transcripts, funnel.
 *
 * Same rules as `store.ts` next door. Narrow methods, ids the server resolved,
 * no table name parameter, no filter to widen. The difference is where the
 * decisions live: almost every method here is one RPC call, because the answer
 * to "may this caller start" has to be correct when two Vercel instances ask at
 * the same millisecond, and that is a question only Postgres can settle. Read
 * `db/ops-schema.sql` before changing any of it — the logic is in the SQL, and
 * this file is the typed doorway to it.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Admission {
  admitted: boolean;
  /** Leases held after this call. What the UI shows as "3 of 10 lines busy". */
  active: number;
  /** Slots reserved for promoted queue tickets that have not been claimed yet. */
  pending: number;
}

export type QueueStatus = "WAITING" | "ADMITTED" | "CLAIMED" | "LEFT" | "EXPIRED";

export interface QueueState {
  status: QueueStatus;
  /** 1-based while WAITING, 0 once admitted, absent once the ticket is done. */
  position?: number;
  claimToken?: string;
  claimExpiresAt?: number;
  waitedMs?: number;
  active?: number;
}

export interface RateVerdict {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: number;
}

export interface GuestBudget {
  allowed: boolean;
  usedMs: number;
  remainingMs: number;
  resetAt?: number;
}

export interface SecurityEvent {
  sessionId?: string;
  authUserId?: string;
  ipHash?: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  actionTaken: string;
  /** Already redacted by the caller. Capped again in Postgres. */
  safeExcerpt?: string;
  inputHash?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationStart {
  sessionId: string;
  authUserId?: string;
  citizenId?: string;
  ipHash?: string;
  tier: "GUEST" | "AUTHENTICATED";
  identityLevel: string;
  provider: string;
  language?: string;
  queueWaitMs?: number;
}

export interface ConversationEnd {
  endReason: string;
  durationMs?: number;
  serviceId?: string;
  riskScore?: number;
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  estimatedCost?: number;
}

export interface Turn {
  role: "USER" | "ASSISTANT" | "TOOL";
  /** Already redacted by the caller. */
  text: string;
  latencyMs?: number;
  guardrailStatus?: string;
}

export interface ToolEvent {
  toolName: string;
  status: string;
  durationMs?: number;
  safeArgs?: Record<string, unknown>;
  safeResultSummary?: string;
}

export interface AppEvent {
  eventName: string;
  anonymousSessionId?: string;
  authUserId?: string;
  ipHash?: string;
  path?: string;
  serviceId?: string;
  journeyId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Something a person sat down and typed at us.
 *
 * Unlike `AppEvent`, this is free text on purpose, so it is the one table here
 * that can contain anything. Capped and trimmed at the route, never used to
 * decide anything, and read only by an operator.
 */
export interface Feedback {
  kind: "REVIEW" | "REQUEST";
  message: string;
  rating?: number;
  contact?: string;
  path?: string;
  anonymousSessionId?: string;
  authUserId?: string;
  ipHash?: string;
}

export interface OpsStore {
  /**
   * True when this is Postgres. False means one process is deciding capacity,
   * which is fine on a laptop and a correctness bug on Vercel — `capacity.ts`
   * refuses to serve production traffic when this is false.
   */
  durable: boolean;

  // -- capacity ------------------------------------------------------------
  admit(input: {
    sessionId: string;
    authUserId?: string;
    ipHash?: string;
    ttlMs: number;
    max: number;
  }): Promise<Admission>;
  heartbeat(sessionId: string, ttlMs: number): Promise<boolean>;
  release(sessionId: string): Promise<boolean>;
  /** Live leases, for the admin dashboard and the "lines busy" copy. */
  activeLeases(): Promise<number>;

  // -- queue ---------------------------------------------------------------
  queueJoin(input: { authUserId?: string; ipHash?: string; ttlMs: number }): Promise<{
    ticket: string;
    position: number;
  }>;
  queuePoll(input: {
    ticket: string;
    max: number;
    claimMs: number;
    ttlMs: number;
    claimToken: string;
  }): Promise<QueueState>;
  queueClaim(input: {
    ticket: string;
    claimToken: string;
    sessionId: string;
    ttlMs: number;
    max: number;
  }): Promise<{ admitted: boolean; waitedMs?: number; reason?: string }>;
  queueLeave(ticket: string): Promise<boolean>;
  queueDepth(): Promise<number>;

  // -- limits --------------------------------------------------------------
  rateLimit(key: string, windowSeconds: number, max: number): Promise<RateVerdict>;
  guestConsume(input: {
    subjects: string[];
    ms: number;
    budgetMs: number;
    windowSeconds: number;
  }): Promise<GuestBudget>;
  guestRemaining(input: { subjects: string[]; budgetMs: number; windowSeconds: number }): Promise<GuestBudget>;

  // -- cooldowns -----------------------------------------------------------
  cooldown(subject: string): Promise<{ until: number; reason: string } | undefined>;
  setCooldown(subject: string, until: number, reason: string): Promise<void>;

  // -- security ------------------------------------------------------------
  recordSecurityEvent(event: SecurityEvent): Promise<void>;
  /** How many HIGH-severity events this subject caused recently. Drives cooldowns. */
  securityCount(input: { ipHash?: string; authUserId?: string; severity: string; sinceMs: number }): Promise<number>;

  // -- observability -------------------------------------------------------
  /** Returns the conversation id, or undefined when recording is unavailable. */
  startConversation(input: ConversationStart): Promise<string | undefined>;
  appendTurn(conversationId: string, turn: Turn): Promise<void>;
  recordToolEvent(conversationId: string, event: ToolEvent): Promise<void>;
  endConversation(conversationId: string, end: ConversationEnd): Promise<void>;
  conversationForSession(sessionId: string): Promise<string | undefined>;

  // -- funnel --------------------------------------------------------------
  recordAppEvent(event: AppEvent): Promise<void>;

  /**
   * Returns whether the row actually landed, which the funnel does not bother
   * with. A dropped beacon is a missing tick on a chart; a dropped review is
   * somebody's paragraph, and they deserve to be told it did not save.
   */
  recordFeedback(feedback: Feedback): Promise<boolean>;

  // -- auth ----------------------------------------------------------------
  touchProfile(input: { authUserId: string; email?: string; login?: boolean }): Promise<void>;
}

// ---------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------

/**
 * A laptop with no credentials, and the unit tests.
 *
 * Known limit, and it is the important one: this is a single process deciding
 * global capacity. Correct here, wrong on Vercel, which runs many. `durable` is
 * false so nothing can ship it by accident — see `capacity.ts`.
 *
 * ponytail: no eviction beyond the sweeps each method already does. Long-lived
 * dev processes will accumulate a few thousand rate-limit keys and nobody will
 * ever notice; add a sweep if a demo runs for a month.
 */
export function memoryOps(): OpsStore {
  const leases = new Map<string, { authUserId?: string; ipHash?: string; expiresAt: number }>();
  const queue = new Map<
    string,
    {
      id: string;
      authUserId?: string;
      ipHash?: string;
      status: QueueStatus;
      claimToken?: string;
      claimExpiresAt?: number;
      expiresAt: number;
      createdAt: number;
      waitedMs?: number;
    }
  >();
  const limits = new Map<string, number>();
  const guest = new Map<string, number>();
  const cooldowns = new Map<string, { until: number; reason: string }>();
  const security: (SecurityEvent & { at: number })[] = [];
  const conversations = new Map<
    string,
    ConversationStart & { id: string; turns: Turn[]; tools: ToolEvent[]; end?: ConversationEnd }
  >();
  const bySession = new Map<string, string>();
  const appEvents: AppEvent[] = [];
  const feedbacks: Feedback[] = [];
  const profiles = new Map<string, { email?: string; logins: number }>();
  let seq = 0;
  const id = () => `mem-${++seq}`;

  const sweep = (now: number) => {
    for (const [k, v] of leases) if (v.expiresAt < now) leases.delete(k);
    for (const t of queue.values()) {
      if (t.status === "WAITING" && t.expiresAt < now) t.status = "EXPIRED";
      if (t.status === "ADMITTED" && (t.claimExpiresAt ?? 0) < now) t.status = "EXPIRED";
    }
  };
  const waiting = () =>
    [...queue.values()].filter((t) => t.status === "WAITING").sort((a, b) => a.createdAt - b.createdAt);
  const pending = (now: number) =>
    [...queue.values()].filter((t) => t.status === "ADMITTED" && (t.claimExpiresAt ?? 0) > now).length;
  const window = (seconds: number, now: number) => Math.floor(now / (seconds * 1000)) * seconds * 1000;

  return {
    durable: false,

    async admit({ sessionId, authUserId, ipHash, ttlMs, max }) {
      const now = Date.now();
      sweep(now);
      const held = pending(now);
      if (leases.size + held >= max && !leases.has(sessionId)) {
        return { admitted: false, active: leases.size, pending: held };
      }
      leases.set(sessionId, { authUserId, ipHash, expiresAt: now + ttlMs });
      return { admitted: true, active: leases.size, pending: held };
    },
    async heartbeat(sessionId, ttlMs) {
      const lease = leases.get(sessionId);
      if (!lease || lease.expiresAt < Date.now()) return false;
      lease.expiresAt = Date.now() + ttlMs;
      return true;
    },
    async release(sessionId) {
      return leases.delete(sessionId);
    },
    async activeLeases() {
      sweep(Date.now());
      return leases.size;
    },

    async queueJoin({ authUserId, ipHash, ttlMs }) {
      const now = Date.now();
      sweep(now);
      const ticket = id();
      queue.set(ticket, {
        id: ticket,
        authUserId,
        ipHash,
        status: "WAITING",
        expiresAt: now + ttlMs,
        createdAt: now,
      });
      return { ticket, position: waiting().length };
    },
    async queuePoll({ ticket, max, claimMs, ttlMs, claimToken }) {
      const now = Date.now();
      sweep(now);
      const row = queue.get(ticket);
      if (!row) return { status: "EXPIRED" };
      if (row.status === "ADMITTED") {
        return {
          status: "ADMITTED",
          position: 0,
          claimToken: row.claimToken,
          claimExpiresAt: row.claimExpiresAt,
          waitedMs: row.waitedMs,
        };
      }
      if (row.status !== "WAITING") return { status: row.status };

      row.expiresAt = now + ttlMs;
      const line = waiting();
      const position = line.findIndex((t) => t.id === ticket) + 1;

      if (leases.size + pending(now) < max && line[0]?.id === ticket) {
        row.status = "ADMITTED";
        row.claimToken = claimToken;
        row.claimExpiresAt = now + claimMs;
        row.waitedMs = now - row.createdAt;
        return { status: "ADMITTED", position: 0, claimToken, claimExpiresAt: row.claimExpiresAt, waitedMs: row.waitedMs };
      }
      return { status: "WAITING", position, active: leases.size };
    },
    async queueClaim({ ticket, claimToken, sessionId, ttlMs, max }) {
      const now = Date.now();
      sweep(now);
      const row = queue.get(ticket);
      if (!row || row.status !== "ADMITTED" || row.claimToken !== claimToken) {
        return { admitted: false, reason: "NO_CLAIM" };
      }
      if (leases.size >= max) return { admitted: false, reason: "FULL" };
      leases.set(sessionId, { authUserId: row.authUserId, ipHash: row.ipHash, expiresAt: now + ttlMs });
      row.status = "CLAIMED";
      return { admitted: true, waitedMs: row.waitedMs };
    },
    async queueLeave(ticket) {
      const row = queue.get(ticket);
      if (!row || (row.status !== "WAITING" && row.status !== "ADMITTED")) return false;
      row.status = "LEFT";
      return true;
    },
    async queueDepth() {
      sweep(Date.now());
      return waiting().length;
    },

    async rateLimit(key, windowSeconds, max) {
      const now = Date.now();
      const bucket = `${key}@${window(windowSeconds, now)}`;
      const count = (limits.get(bucket) ?? 0) + 1;
      limits.set(bucket, count);
      return { allowed: count <= max, count, limit: max, resetAt: window(windowSeconds, now) + windowSeconds * 1000 };
    },
    async guestConsume({ subjects, ms, budgetMs, windowSeconds }) {
      const now = Date.now();
      const start = window(windowSeconds, now);
      let worst = 0;
      for (const s of subjects) {
        const key = `${s}@${start}`;
        const used = (guest.get(key) ?? 0) + ms;
        guest.set(key, used);
        worst = Math.max(worst, used);
      }
      return {
        allowed: worst <= budgetMs,
        usedMs: worst,
        remainingMs: Math.max(0, budgetMs - worst),
        resetAt: start + windowSeconds * 1000,
      };
    },
    async guestRemaining({ subjects, budgetMs, windowSeconds }) {
      const start = window(windowSeconds, Date.now());
      const worst = Math.max(0, ...subjects.map((s) => guest.get(`${s}@${start}`) ?? 0));
      return { allowed: worst < budgetMs, usedMs: worst, remainingMs: Math.max(0, budgetMs - worst) };
    },

    async cooldown(subject) {
      const found = cooldowns.get(subject);
      if (!found || found.until < Date.now()) return undefined;
      return found;
    },
    async setCooldown(subject, until, reason) {
      cooldowns.set(subject, { until, reason });
    },

    async recordSecurityEvent(event) {
      security.push({ ...event, at: Date.now() });
    },
    async securityCount({ ipHash, authUserId, severity, sinceMs }) {
      const since = Date.now() - sinceMs;
      return security.filter(
        (e) =>
          e.at >= since &&
          e.severity === severity &&
          ((ipHash && e.ipHash === ipHash) || (authUserId && e.authUserId === authUserId)),
      ).length;
    },

    async startConversation(input) {
      const cid = id();
      conversations.set(cid, { ...input, id: cid, turns: [], tools: [] });
      bySession.set(input.sessionId, cid);
      return cid;
    },
    async appendTurn(conversationId, turn) {
      conversations.get(conversationId)?.turns.push(turn);
    },
    async recordToolEvent(conversationId, event) {
      conversations.get(conversationId)?.tools.push(event);
    },
    async endConversation(conversationId, end) {
      const c = conversations.get(conversationId);
      if (c) c.end = end;
    },
    async conversationForSession(sessionId) {
      return bySession.get(sessionId);
    },

    async recordAppEvent(event) {
      appEvents.push(event);
    },

    async recordFeedback(feedback) {
      feedbacks.push(feedback);
      return true;
    },

    async touchProfile({ authUserId, email, login }) {
      const p = profiles.get(authUserId) ?? { logins: 0 };
      profiles.set(authUserId, { email: email ?? p.email, logins: p.logins + (login ? 1 : 0) });
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * The production one. Every capacity and limit decision is a single RPC, which
 * is the whole point: the check and the write happen inside one transaction
 * under one advisory lock, so instance A and instance B cannot both be told
 * they got the last line.
 *
 * Telemetry writes are the exception and they fail soft. Losing a funnel row is
 * not worth failing a citizen's request over; losing an admission decision is.
 */
export function supabaseOps(db: SupabaseClient): OpsStore {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`ops store: ${what}: ${error.message}`);
  };

  /**
   * For writes nobody is waiting on. A dropped analytics row is a worse thing
   * to page somebody about than to lose, and a transcript insert must never be
   * what ends a working call.
   */
  const soft = async (what: string, run: () => Promise<{ error: { message: string } | null }>) => {
    try {
      const { error } = await run();
      if (error) console.warn(`ops store: ${what} failed`, error.message);
    } catch (error) {
      console.warn(`ops store: ${what} failed`, error instanceof Error ? error.message : error);
    }
  };

  const at = (value: unknown): number | undefined => {
    const parsed = value ? Date.parse(String(value)) : Number.NaN;
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return {
    durable: true,

    async admit({ sessionId, authUserId, ipHash, ttlMs, max }) {
      const { data, error } = await db.rpc("voice_admit", {
        p_session_id: sessionId,
        p_auth_user_id: authUserId ?? null,
        p_ip_hash: ipHash ?? null,
        p_ttl_ms: ttlMs,
        p_max: max,
      });
      fail("admitting", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        admitted: Boolean(row.admitted),
        active: Number(row.active ?? 0),
        pending: Number(row.pending ?? 0),
      };
    },
    async heartbeat(sessionId, ttlMs) {
      const { data, error } = await db.rpc("voice_heartbeat", { p_session_id: sessionId, p_ttl_ms: ttlMs });
      fail("heartbeat", error);
      return Boolean(data);
    },
    async release(sessionId) {
      const { data, error } = await db.rpc("voice_release", { p_session_id: sessionId });
      fail("releasing", error);
      return Boolean(data);
    },
    async activeLeases() {
      const { count, error } = await db
        .from("voice_capacity_leases")
        .select("session_id", { count: "exact", head: true })
        .gt("lease_expires_at", new Date().toISOString());
      fail("counting leases", error);
      return count ?? 0;
    },

    async queueJoin({ authUserId, ipHash, ttlMs }) {
      const { data, error } = await db.rpc("voice_queue_join", {
        p_auth_user_id: authUserId ?? null,
        p_ip_hash: ipHash ?? null,
        p_ttl_ms: ttlMs,
      });
      fail("joining queue", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return { ticket: String(row.ticket), position: Number(row.position ?? 1) };
    },
    async queuePoll({ ticket, max, claimMs, ttlMs, claimToken }) {
      const { data, error } = await db.rpc("voice_queue_poll", {
        p_ticket: ticket,
        p_max: max,
        p_claim_ms: claimMs,
        p_ttl_ms: ttlMs,
        p_claim_token: claimToken,
      });
      fail("polling queue", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        status: (row.status as QueueStatus) ?? "EXPIRED",
        position: row.position === undefined ? undefined : Number(row.position),
        claimToken: (row.claimToken as string) ?? undefined,
        claimExpiresAt: at(row.claimExpiresAt),
        waitedMs: row.waitedMs === null || row.waitedMs === undefined ? undefined : Number(row.waitedMs),
        active: row.active === undefined ? undefined : Number(row.active),
      };
    },
    async queueClaim({ ticket, claimToken, sessionId, ttlMs, max }) {
      const { data, error } = await db.rpc("voice_queue_claim", {
        p_ticket: ticket,
        p_claim_token: claimToken,
        p_session_id: sessionId,
        p_ttl_ms: ttlMs,
        p_max: max,
      });
      fail("claiming queue slot", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        admitted: Boolean(row.admitted),
        waitedMs: row.waitedMs === null || row.waitedMs === undefined ? undefined : Number(row.waitedMs),
        reason: (row.reason as string) ?? undefined,
      };
    },
    async queueLeave(ticket) {
      const { data, error } = await db.rpc("voice_queue_leave", { p_ticket: ticket });
      fail("leaving queue", error);
      return Boolean(data);
    },
    async queueDepth() {
      const { count, error } = await db
        .from("voice_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "WAITING")
        .gt("expires_at", new Date().toISOString());
      fail("counting queue", error);
      return count ?? 0;
    },

    async rateLimit(key, windowSeconds, max) {
      const { data, error } = await db.rpc("ariane_rate_limit", {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max: max,
      });
      fail("rate limiting", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        allowed: Boolean(row.allowed),
        count: Number(row.count ?? 0),
        limit: Number(row.limit ?? max),
        resetAt: at(row.resetAt) ?? Date.now() + windowSeconds * 1000,
      };
    },
    async guestConsume({ subjects, ms, budgetMs, windowSeconds }) {
      const { data, error } = await db.rpc("voice_guest_consume", {
        p_subjects: subjects,
        p_ms: ms,
        p_budget_ms: budgetMs,
        p_window_seconds: windowSeconds,
      });
      fail("consuming guest budget", error);
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        allowed: Boolean(row.allowed),
        usedMs: Number(row.usedMs ?? 0),
        remainingMs: Number(row.remainingMs ?? 0),
        resetAt: at(row.resetAt),
      };
    },
    async guestRemaining({ subjects, budgetMs, windowSeconds }) {
      const { data, error } = await db.rpc("voice_guest_remaining", {
        p_subjects: subjects,
        p_budget_ms: budgetMs,
        p_window_seconds: windowSeconds,
      });
      fail("reading guest budget", error);
      const row = (data ?? {}) as Record<string, unknown>;
      const remaining = Number(row.remainingMs ?? budgetMs);
      return { allowed: remaining > 0, usedMs: Number(row.usedMs ?? 0), remainingMs: remaining };
    },

    async cooldown(subject) {
      const { data, error } = await db
        .from("ariane_cooldowns")
        .select("until,reason")
        .eq("subject", subject)
        .gt("until", new Date().toISOString())
        .maybeSingle();
      fail("reading cooldown", error);
      if (!data) return undefined;
      return { until: at(data.until) ?? 0, reason: String(data.reason) };
    },
    async setCooldown(subject, until, reason) {
      const { error } = await db
        .from("ariane_cooldowns")
        .upsert({ subject, until: new Date(until).toISOString(), reason }, { onConflict: "subject" });
      fail("setting cooldown", error);
    },

    async recordSecurityEvent(event) {
      // Not soft. A security event we failed to write is a security event that
      // did not happen, and the cooldown that should follow it never fires.
      const { error } = await db.from("security_events").insert({
        session_id: event.sessionId ?? null,
        auth_user_id: event.authUserId ?? null,
        ip_hash: event.ipHash ?? null,
        category: event.category,
        severity: event.severity,
        action_taken: event.actionTaken,
        safe_excerpt: event.safeExcerpt ?? null,
        input_hash: event.inputHash ?? null,
        metadata: event.metadata ?? {},
      });
      fail("recording security event", error);
    },
    async securityCount({ ipHash, authUserId, severity, sinceMs }) {
      let query = db
        .from("security_events")
        .select("id", { count: "exact", head: true })
        .eq("severity", severity)
        .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
      // One subject or the other, never a caller-supplied filter.
      if (authUserId) query = query.eq("auth_user_id", authUserId);
      else if (ipHash) query = query.eq("ip_hash", ipHash);
      else return 0;
      const { count, error } = await query;
      fail("counting security events", error);
      return count ?? 0;
    },

    async startConversation(input) {
      const { data, error } = await db
        .from("voice_conversations")
        .upsert(
          {
            session_id: input.sessionId,
            auth_user_id: input.authUserId ?? null,
            citizen_id: input.citizenId ?? null,
            ip_hash: input.ipHash ?? null,
            tier: input.tier,
            identity_level: input.identityLevel,
            provider: input.provider,
            language: input.language ?? null,
            queue_wait_ms: input.queueWaitMs ?? null,
          },
          { onConflict: "session_id" },
        )
        .select("id")
        .single();
      if (error) {
        console.warn("ops store: starting conversation failed", error.message);
        return undefined;
      }
      return String((data as Record<string, unknown>).id);
    },
    async appendTurn(conversationId, turn) {
      // The sequence is derived in one statement rather than read-then-write,
      // so two turns arriving together cannot both claim the same number. The
      // unique index is the backstop if they somehow do.
      await soft("appending turn", async () =>
        db.rpc("voice_append_turn", {
          p_conversation_id: conversationId,
          p_role: turn.role,
          p_text: turn.text,
          p_latency_ms: turn.latencyMs ?? null,
          p_guardrail_status: turn.guardrailStatus ?? null,
        }),
      );
    },
    async recordToolEvent(conversationId, event) {
      await soft("recording tool event", async () =>
        db.rpc("voice_record_tool", {
          p_conversation_id: conversationId,
          p_tool_name: event.toolName,
          p_status: event.status,
          p_duration_ms: event.durationMs ?? null,
          p_safe_args: event.safeArgs ?? {},
          p_safe_result: event.safeResultSummary ?? null,
        }),
      );
    },
    async endConversation(conversationId, end) {
      await soft("ending conversation", async () =>
        db
          .from("voice_conversations")
          .update({
            ended_at: new Date().toISOString(),
            end_reason: end.endReason,
            duration_ms: end.durationMs ?? null,
            service_id: end.serviceId ?? null,
            risk_score: end.riskScore ?? 0,
            input_audio_tokens: end.inputAudioTokens ?? null,
            output_audio_tokens: end.outputAudioTokens ?? null,
            estimated_cost: end.estimatedCost ?? null,
          })
          .eq("id", conversationId),
      );
    },
    async conversationForSession(sessionId) {
      const { data, error } = await db
        .from("voice_conversations")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error || !data) return undefined;
      return String((data as Record<string, unknown>).id);
    },

    async recordAppEvent(event) {
      await soft("recording app event", async () =>
        db.from("app_events").insert({
          anonymous_session_id: event.anonymousSessionId ?? null,
          auth_user_id: event.authUserId ?? null,
          ip_hash: event.ipHash ?? null,
          event_name: event.eventName,
          path: event.path ?? null,
          service_id: event.serviceId ?? null,
          journey_id: event.journeyId ?? null,
          metadata: event.metadata ?? {},
        }),
      );
    },

    async recordFeedback(feedback) {
      try {
        const { error } = await db.from("ariane_feedback").insert({
          kind: feedback.kind,
          message: feedback.message,
          rating: feedback.rating ?? null,
          contact: feedback.contact ?? null,
          path: feedback.path ?? null,
          anonymous_session_id: feedback.anonymousSessionId ?? null,
          auth_user_id: feedback.authUserId ?? null,
          ip_hash: feedback.ipHash ?? null,
        });
        if (error) console.warn("ops store: recording feedback failed", error.message);
        return !error;
      } catch (error) {
        console.warn("ops store: recording feedback failed", error instanceof Error ? error.message : error);
        return false;
      }
    },

    async touchProfile({ authUserId, email, login }) {
      await soft("touching profile", async () =>
        db.rpc("ariane_touch_profile", {
          p_auth_user_id: authUserId,
          p_email: email ?? null,
          p_login: Boolean(login),
        }),
      );
    },
  };
}
