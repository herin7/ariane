import { randomBytes } from "node:crypto";
import { CAPACITY, RATE_LIMITS, TIERS, type Tier } from "../policy";
import { guestSubjects } from "./net";
import type { OpsStore } from "./store";

/**
 * May this caller start talking, and for how long.
 *
 * One function answers it — `admit` — and it is the only path to a realtime
 * session. Everything expensive lives behind it: the provider credential is not
 * minted, the WebRTC offer is not made and no audio token is spent until this
 * has said yes. That ordering is the entire cost control. A queued caller has
 * an id and a poll loop and nothing else.
 *
 * Nothing in here reads a duration, a limit or a position from the request. The
 * caller supplies who they are (a cookie, a session, an address) and this file
 * supplies what that is worth, from `policy.ts`.
 */

// ---------------------------------------------------------------------------

export interface AdmitRequest {
  sessionId: string;
  tier: Tier;
  authUserId?: string;
  ipHash?: string;
  guestId?: string;
  /** Set when this caller waited in line. Both halves required. */
  ticket?: string;
  claimToken?: string;
}

export type AdmitResult =
  | { ok: true; maxCallMs: number; expiresAt: number; active: number; waitedMs?: number }
  | { ok: false; reason: "RATE_LIMITED"; retryAt: number }
  | { ok: false; reason: "COOLDOWN"; until: number }
  | { ok: false; reason: "GUEST_QUOTA"; resetAt?: number }
  | { ok: false; reason: "BUSY"; active: number; queueDepth: number }
  | { ok: false; reason: "CLAIM_INVALID" };

export interface QueueView {
  status: "WAITING" | "ADMITTED" | "GONE";
  position?: number;
  estimatedWaitMs?: number;
  claimToken?: string;
  claimExpiresAt?: number;
}

/**
 * Under this, the call did not happen. A greeting takes longer than eight
 * seconds to ask for and answer, so nothing below it was a conversation.
 */
const NEVER_HAPPENED_MS = 8_000;

/**
 * The subjects a limit is charged against, most specific first.
 *
 * A logged-in user is limited as that user, so sharing an office IP does not
 * make colleagues share a quota. A guest has only an address and a cookie.
 */
function subjectsFor(input: { authUserId?: string; ipHash?: string; guestId?: string }): string[] {
  const subjects: string[] = [];
  if (input.authUserId) subjects.push(`user:${input.authUserId}`);
  if (input.ipHash) subjects.push(`ip:${input.ipHash}`);
  if (!input.authUserId && !input.ipHash && input.guestId) subjects.push(`guest:${input.guestId}`);
  return subjects;
}

export class VoiceCapacity {
  constructor(private readonly ops: OpsStore) {}

  /**
   * The gate.
   *
   * Order matters and is deliberate: refuse the abusive caller before spending
   * a database round trip on the queue, and reserve the guest's minute before
   * taking a line so two tabs cannot each get one. Every early return leaves no
   * lease and no reservation behind.
   */
  async admit(request: AdmitRequest): Promise<AdmitResult> {
    const { sessionId, tier, authUserId, ipHash, guestId } = request;
    const subjects = subjectsFor({ authUserId, ipHash, guestId });

    // 1. Serving a cooldown for repeated HIGH-severity events. Server policy
    //    decided this from counted rows, not a classifier's opinion.
    for (const subject of subjects) {
      const held = await this.ops.cooldown(subject);
      if (held) return { ok: false, reason: "COOLDOWN", until: held.until };
    }

    // 2. Session creation rate. Retrying a dropped call is normal; forty in a
    //    minute is not a person.
    for (const subject of subjects) {
      const verdict = await this.ops.rateLimit(
        `voice:session:${subject}`,
        RATE_LIMITS.voiceSession.windowSeconds,
        RATE_LIMITS.voiceSession.max,
      );
      if (!verdict.allowed) return { ok: false, reason: "RATE_LIMITED", retryAt: verdict.resetAt };
    }

    const limits = TIERS[tier];

    // 3. The guest's one minute, reserved in full and up front.
    //
    //    Charging at the *start* rather than the end is what makes refreshing
    //    useless: a guest who hangs up at four seconds has still spent their
    //    allowance, so a new tab finds an empty account. The reservation is
    //    refunded below if the call never actually starts.
    const guest = tier === "GUEST" ? guestSubjects({ guestId, ipHash }) : [];
    if (tier === "GUEST") {
      if (!guest.length) {
        // No cookie and no trustworthy address. We cannot tell this caller from
        // the next one, so we cannot give either of them a free minute.
        return { ok: false, reason: "GUEST_QUOTA" };
      }
      const budget = await this.ops.guestConsume({
        subjects: guest,
        ms: limits.maxCallMs,
        budgetMs: limits.dailyMs,
        windowSeconds: limits.dailyWindowSeconds,
      });
      if (!budget.allowed) {
        await this.refund(guest, limits.maxCallMs, limits);
        return { ok: false, reason: "GUEST_QUOTA", resetAt: budget.resetAt };
      }
    }

    // 4. A line, either claimed from the queue or taken directly.
    const ttlMs = limits.maxCallMs + CAPACITY.leaseTtlMs;
    let waitedMs: number | undefined;
    let active: number;

    if (request.ticket && request.claimToken) {
      const claim = await this.ops.queueClaim({
        ticket: request.ticket,
        claimToken: request.claimToken,
        sessionId,
        ttlMs,
        max: CAPACITY.maxConcurrentCalls,
      });
      if (!claim.admitted) {
        await this.refund(guest, limits.maxCallMs, limits);
        // A stale or forged claim is not "busy", it is "start again". Saying so
        // separately keeps a caller from thinking the service is full when
        // their ticket simply expired.
        return claim.reason === "FULL"
          ? { ok: false, reason: "BUSY", active: await this.ops.activeLeases(), queueDepth: await this.ops.queueDepth() }
          : { ok: false, reason: "CLAIM_INVALID" };
      }
      waitedMs = claim.waitedMs;
      active = await this.ops.activeLeases();
    } else {
      const admission = await this.ops.admit({
        sessionId,
        authUserId,
        ipHash,
        ttlMs,
        max: CAPACITY.maxConcurrentCalls,
      });
      if (!admission.admitted) {
        await this.refund(guest, limits.maxCallMs, limits);
        return {
          ok: false,
          reason: "BUSY",
          active: admission.active,
          queueDepth: await this.ops.queueDepth(),
        };
      }
      active = admission.active;
    }

    return { ok: true, maxCallMs: limits.maxCallMs, expiresAt: Date.now() + limits.maxCallMs, active, waitedMs };
  }

  /**
   * Hang up on a call that never happened, and put the minute back.
   *
   * `admit` charges a guest their whole minute up front and that stays true: it
   * is what makes a refresh worthless. What was wrong was charging it for a
   * call that spent its whole life on a handshake that failed. The caller
   * pressed the retry button and was told their preview was over, about a
   * conversation that never had a word in it.
   *
   * All or nothing, and not a partial refund, because the reservation is all or
   * nothing: `admit` asks for the full minute against a one minute budget, so
   * handing back forty seconds would leave twenty behind and still refuse the
   * next call. Half a fix reads worse than none.
   *
   * ponytail: the eight second window is the whole test for "never happened",
   * so a script could hang up at seven seconds on repeat and keep its minute.
   * What stops that is `RATE_LIMITS.voiceSession`, six session opens a minute
   * per cookie and per address, which caps the loop at six greetings. Make this
   * a real signal - a recorded assistant turn - if that ever stops being enough.
   */
  async settle(input: { tier: Tier; guestId?: string; ipHash?: string; usedMs: number }): Promise<void> {
    if (input.tier !== "GUEST" || input.usedMs >= NEVER_HAPPENED_MS) return;
    const limits = TIERS[input.tier];
    await this.refund(guestSubjects({ guestId: input.guestId, ipHash: input.ipHash }), limits.maxCallMs, limits);
  }

  /** Give back a reservation for a call that never happened. Best effort. */
  private async refund(subjects: string[], ms: number, limits: (typeof TIERS)[Tier]): Promise<void> {
    if (!subjects.length) return;
    try {
      await this.ops.guestConsume({
        subjects,
        ms: -ms,
        budgetMs: limits.dailyMs,
        windowSeconds: limits.dailyWindowSeconds,
      });
    } catch (error) {
      // A lost refund costs one guest one minute. Failing their request over it
      // would cost them the whole thing.
      console.warn("voice capacity: refund failed", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Still here. Returns false when the lease has already gone, which is the
   * client's signal to stop and tear down rather than keep an orphaned call up.
   */
  heartbeat(sessionId: string): Promise<boolean> {
    return this.ops.heartbeat(sessionId, CAPACITY.leaseTtlMs);
  }

  /**
   * Hand the line back.
   *
   * Called on hangup, on timeout, on provider failure, on auth failure and from
   * the browser's unload beacon — and none of those are load bearing, because
   * the lease expires on its own if every one of them is missed. Client release
   * is an optimisation, never the mechanism.
   */
  release(sessionId: string): Promise<boolean> {
    return this.ops.release(sessionId);
  }

  async join(input: { authUserId?: string; ipHash?: string }): Promise<{ ticket: string; view: QueueView }> {
    const { ticket, position } = await this.ops.queueJoin({ ...input, ttlMs: CAPACITY.queueTtlMs });
    return { ticket, view: { status: "WAITING", position, estimatedWaitMs: estimateWait(position) } };
  }

  /**
   * Where am I in line.
   *
   * The claim token is minted here, on the server, and only written by Postgres
   * when this ticket is genuinely at the front with a slot free. Generating it
   * unconditionally is cheap and means the SQL never has to reach for an
   * extension to make randomness.
   */
  async poll(ticket: string): Promise<QueueView> {
    const state = await this.ops.queuePoll({
      ticket,
      max: CAPACITY.maxConcurrentCalls,
      claimMs: CAPACITY.claimMs,
      ttlMs: CAPACITY.queueTtlMs,
      claimToken: randomBytes(24).toString("base64url"),
    });

    if (state.status === "ADMITTED") {
      return {
        status: "ADMITTED",
        position: 0,
        claimToken: state.claimToken,
        claimExpiresAt: state.claimExpiresAt,
      };
    }
    if (state.status !== "WAITING") return { status: "GONE" };
    return {
      status: "WAITING",
      position: state.position,
      estimatedWaitMs: estimateWait(state.position ?? 1),
    };
  }

  leave(ticket: string): Promise<boolean> {
    return this.ops.queueLeave(ticket);
  }

  /** For the "N of 10 lines busy" copy and the admin dashboard. */
  async load(): Promise<{ active: number; max: number; queued: number }> {
    const [active, queued] = await Promise.all([this.ops.activeLeases(), this.ops.queueDepth()]);
    return { active, max: CAPACITY.maxConcurrentCalls, queued };
  }
}

/**
 * A number to put next to "about". Position over lines, times a typical call.
 *
 * ponytail: a guess, not a model. It is off by a lot when the first person in
 * line has just started a ten minute call, and the UI says "about" for exactly
 * that reason. Measure real durations from `voice_conversations` if it ever
 * matters enough to be wrong precisely.
 */
function estimateWait(position: number): number {
  return Math.max(0, Math.ceil(position / CAPACITY.maxConcurrentCalls) * CAPACITY.typicalCallMs);
}
