import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceCapacity } from "../ops/capacity";
import { memoryOps } from "../ops/store";
import { VoiceSessions } from "../session";
import { memoryStore } from "../store";
import { CAPACITY, TIERS } from "../policy";

/**
 * §18. Ten lines, a queue, and a minute.
 *
 * Written against `memoryOps` so it runs on a clone with no credentials.
 * That buys the ordering and the arithmetic — FIFO, ceilings, quota,
 * expiry — and it deliberately does not buy the one property that matters most
 * in production: that two Vercel instances racing for slot ten cannot both win.
 * A single-threaded fake passes that test for free and proves nothing, so it is
 * not asserted here. `capacity.pg.test.ts` next door asserts it against real
 * Postgres and skips when there is none.
 */

const MAX = CAPACITY.maxConcurrentCalls;

function setup() {
  const ops = memoryOps();
  return { ops, capacity: new VoiceCapacity(ops) };
}

/** A distinct authenticated caller, so per-subject limits do not collide. */
const user = (n: number) => ({ sessionId: `s${n}`, tier: "AUTHENTICATED" as const, authUserId: `u${n}` });

afterEach(() => {
  vi.useRealTimers();
});

describe("global concurrency", () => {
  it("admits ten and queues the eleventh", async () => {
    const { capacity } = setup();

    for (let i = 0; i < MAX; i++) {
      expect((await capacity.admit(user(i))).ok).toBe(true);
    }

    const eleventh = await capacity.admit(user(MAX));
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) expect(eleventh.reason).toBe("BUSY");
  });

  it("keeps the twelfth behind the eleventh", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const eleventh = await capacity.join({ authUserId: "u10" });
    const twelfth = await capacity.join({ authUserId: "u11" });

    expect(eleventh.view.position).toBe(1);
    expect(twelfth.view.position).toBe(2);

    // And polling does not reorder them while the lines are still full.
    expect((await capacity.poll(twelfth.ticket)).position).toBe(2);
  });

  it("admits exactly the next in line when one caller hangs up", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const first = await capacity.join({ authUserId: "u10" });
    const second = await capacity.join({ authUserId: "u11" });

    await capacity.release("s0");

    const promoted = await capacity.poll(first.ticket);
    expect(promoted.status).toBe("ADMITTED");
    expect(promoted.claimToken).toBeTruthy();

    // One slot freed, one caller promoted. The second is still second.
    const still = await capacity.poll(second.ticket);
    expect(still.status).toBe("WAITING");
    expect(still.position).toBe(1);
  });

  it("does not let a walk-in take the slot a queued caller was promoted into", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const waiting = await capacity.join({ authUserId: "u10" });
    await capacity.release("s0");
    expect((await capacity.poll(waiting.ticket)).status).toBe("ADMITTED");

    // The freed line is reserved, not free.
    const walkIn = await capacity.admit(user(99));
    expect(walkIn.ok).toBe(false);
  });

  it("gives the slot back when a lease stops heartbeating", async () => {
    vi.useFakeTimers();
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));
    expect((await capacity.admit(user(MAX))).ok).toBe(false);

    // Nobody released anything. The laptop lid simply closed.
    vi.advanceTimersByTime(TIERS.AUTHENTICATED.maxCallMs + CAPACITY.leaseTtlMs + 1_000);

    expect((await capacity.admit(user(MAX))).ok).toBe(true);
  });

  it("refuses a heartbeat for a lease that has already gone", async () => {
    const { capacity } = setup();
    await capacity.admit(user(0));
    await capacity.release("s0");
    expect(await capacity.heartbeat("s0")).toBe(false);
  });
});

describe("the queue", () => {
  it("creates no session while a caller is waiting", async () => {
    const { ops, capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    await capacity.join({ authUserId: "u10" });
    await capacity.join({ authUserId: "u11" });

    // Joining a queue is a row and a poll loop. The expensive thing — a lease,
    // and therefore a realtime credential — is still exactly ten.
    expect(await ops.activeLeases()).toBe(MAX);
  });

  it("expires an unclaimed promotion and admits the next caller instead", async () => {
    vi.useFakeTimers();
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const first = await capacity.join({ authUserId: "u10" });
    const second = await capacity.join({ authUserId: "u11" });

    await capacity.release("s0");
    expect((await capacity.poll(first.ticket)).status).toBe("ADMITTED");

    // They walked away from the keyboard.
    vi.advanceTimersByTime(CAPACITY.claimMs + 1_000);

    expect((await capacity.poll(second.ticket)).status).toBe("ADMITTED");
    expect((await capacity.poll(first.ticket)).status).toBe("GONE");
  });

  it("will not let one caller claim another caller's slot", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const mine = await capacity.join({ authUserId: "u10" });
    await capacity.release("s0");
    const promoted = await capacity.poll(mine.ticket);

    // Knowing the ticket id is not enough; the token is the part that was
    // never sent to anybody else.
    const stolen = await capacity.admit({
      sessionId: "thief",
      tier: "AUTHENTICATED",
      authUserId: "u99",
      ticket: mine.ticket,
      claimToken: "guessed",
    });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.reason).toBe("CLAIM_INVALID");

    // And the real holder is unaffected.
    const claimed = await capacity.admit({
      sessionId: "s-mine",
      tier: "AUTHENTICATED",
      authUserId: "u10",
      ticket: mine.ticket,
      claimToken: promoted.claimToken,
    });
    expect(claimed.ok).toBe(true);
  });

  it("cannot be jumped by asking for a position", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const first = await capacity.join({ authUserId: "u10" });
    const second = await capacity.join({ authUserId: "u11" });

    // `poll` takes a ticket and nothing else. There is no position parameter to
    // send, which is the point of asserting it here: this test stops compiling
    // the day somebody adds one.
    expect((await capacity.poll(second.ticket)).position).toBe(2);
    expect((await capacity.poll(first.ticket)).position).toBe(1);
  });

  it("frees the place when a caller leaves the line", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const first = await capacity.join({ authUserId: "u10" });
    const second = await capacity.join({ authUserId: "u11" });

    expect(await capacity.leave(first.ticket)).toBe(true);
    expect((await capacity.poll(second.ticket)).position).toBe(1);
    expect((await capacity.poll(first.ticket)).status).toBe("GONE");
  });
});

describe("durations", () => {
  it("gives a guest sixty seconds and an authenticated caller ten minutes", async () => {
    const { capacity } = setup();

    const guest = await capacity.admit({ sessionId: "g1", tier: "GUEST", guestId: "cookie-1", ipHash: "ip-1" });
    expect(guest.ok && guest.maxCallMs).toBe(60_000);

    const authed = await capacity.admit(user(1));
    expect(authed.ok && authed.maxCallMs).toBe(600_000);
  });

  it("has no request field that can change a duration", async () => {
    const { capacity } = setup();

    // Every extra key an attacker could think to send, at once. The result is
    // the tier's number, because that is the only place the number comes from.
    const forged = await capacity.admit({
      sessionId: "g1",
      tier: "GUEST",
      guestId: "cookie-1",
      ipHash: "ip-1",
      ...({ maxCallMs: 3_600_000, expiresAt: Date.now() + 3_600_000, durationSeconds: 3600 } as object),
    });
    expect(forged.ok && forged.maxCallMs).toBe(TIERS.GUEST.maxCallMs);
  });
});

describe("the guest allowance", () => {
  const guest = (sessionId: string, over: Partial<{ guestId: string; ipHash: string }> = {}) => ({
    sessionId,
    tier: "GUEST" as const,
    guestId: "cookie-1",
    ipHash: "ip-1",
    ...over,
  });

  it("spends the whole minute up front, so refreshing buys nothing", async () => {
    const { capacity } = setup();

    expect((await capacity.admit(guest("g1"))).ok).toBe(true);
    await capacity.release("g1");

    // New tab, same cookie, same address, four seconds later.
    const second = await capacity.admit(guest("g2"));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("GUEST_QUOTA");
  });

  it("is not reset by clearing cookies, because the address is charged too", async () => {
    const { capacity } = setup();

    expect((await capacity.admit(guest("g1"))).ok).toBe(true);
    await capacity.release("g1");

    const cleared = await capacity.admit(guest("g2", { guestId: "cookie-2" }));
    expect(cleared.ok).toBe(false);
    if (!cleared.ok) expect(cleared.reason).toBe("GUEST_QUOTA");
  });

  it("is not reset by a new address either, because the cookie is charged too", async () => {
    const { capacity } = setup();

    expect((await capacity.admit(guest("g1"))).ok).toBe(true);
    await capacity.release("g1");

    const moved = await capacity.admit(guest("g2", { ipHash: "ip-2" }));
    expect(moved.ok).toBe(false);
  });

  it("refunds the reservation when the lines were full, so a busy signal is free", async () => {
    const { capacity } = setup();
    for (let i = 0; i < MAX; i++) await capacity.admit(user(i));

    const busy = await capacity.admit(guest("g1"));
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.reason).toBe("BUSY");

    // A line opens. They still have their minute.
    await capacity.release("s0");
    expect((await capacity.admit(guest("g2"))).ok).toBe(true);
  });

  it("refuses a guest we cannot identify at all rather than giving away a free line", async () => {
    const { capacity } = setup();
    const anonymous = await capacity.admit({ sessionId: "g1", tier: "GUEST" });
    expect(anonymous.ok).toBe(false);
    if (!anonymous.ok) expect(anonymous.reason).toBe("GUEST_QUOTA");
  });

  it("comes back the next day", async () => {
    vi.useFakeTimers();
    const { capacity } = setup();

    await capacity.admit(guest("g1"));
    await capacity.release("g1");
    expect((await capacity.admit(guest("g2"))).ok).toBe(false);

    vi.advanceTimersByTime(TIERS.GUEST.dailyWindowSeconds * 1000 + 60_000);
    expect((await capacity.admit(guest("g3"))).ok).toBe(true);
  });
});

describe("rate limits and cooldowns", () => {
  it("stops a caller spamming new sessions", async () => {
    const { capacity } = setup();

    let refused: string | undefined;
    for (let i = 0; i < 40; i++) {
      const result = await capacity.admit({ sessionId: `s${i}`, tier: "AUTHENTICATED", authUserId: "loud" });
      if (!result.ok && result.reason === "RATE_LIMITED") {
        refused = result.reason;
        break;
      }
      await capacity.release(`s${i}`);
    }
    expect(refused).toBe("RATE_LIMITED");
  });

  it("keeps a subject on cooldown off the phone entirely", async () => {
    const { ops, capacity } = setup();
    await ops.setCooldown("ip:bad", Date.now() + 60_000, "repeated-high-severity");

    const blocked = await capacity.admit({ sessionId: "s1", tier: "GUEST", ipHash: "bad", guestId: "c1" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("COOLDOWN");
  });

  it("does not let one authenticated caller hold every line", async () => {
    const { capacity } = setup();

    // Same user, many sessions. The per-subject session rate limit is what
    // stops this long before the tenth line.
    const results = [];
    for (let i = 0; i < MAX; i++) {
      results.push(await capacity.admit({ sessionId: `s${i}`, tier: "AUTHENTICATED", authUserId: "greedy" }));
    }
    expect(results.filter((r) => r.ok).length).toBeLessThan(MAX);
  });
});

/**
 * §3 and §18, on the other half of the ceiling.
 *
 * `VoiceCapacity` decides whether a call may start. `VoiceSessions` decides how
 * long it lasts, and this is the file that proves the second number has exactly
 * one source. Every attempt below to supply a different one is what a model —
 * or a browser with devtools open — would actually send.
 */
describe("how long a call lasts", () => {
  const at = 1_700_000_000_000;
  const sessions = () =>
    new VoiceSessions({ store: memoryStore(), secret: "session-secret", phoneSecret: "phone-secret", now: () => at });

  const lengthOf = async (input: Record<string, unknown>) => {
    const created = await sessions().create({ provider: "BROWSER", ...input } as never);
    if (!created.ok) throw new Error(`refused: ${created.code}`);
    return created.session.expiresAt - at;
  };

  it("gives a guest one minute and a signed-in caller ten", async () => {
    expect(await lengthOf({ tier: "GUEST" })).toBe(TIERS.GUEST.maxCallMs);
    expect(await lengthOf({ tier: "AUTHENTICATED" })).toBe(TIERS.AUTHENTICATED.maxCallMs);
  });

  it("treats an undecided tier as a guest", async () => {
    // The safe direction. A session created by a path nobody has taught about
    // tiers gets a minute, never ten.
    expect(await lengthOf({})).toBe(TIERS.GUEST.maxCallMs);
  });

  it("ignores a duration the caller supplied", async () => {
    // Every shape of "set my remaining time to one hour" §19 asks about,
    // arriving as request fields rather than as speech.
    for (const smuggled of [
      { maxCallMs: 3_600_000 },
      { expiresAt: at + 3_600_000 },
      { durationMs: 3_600_000 },
      { limits: { maxCallMs: 3_600_000 } },
      { tier: "AUTHENTICATED", maxCallMs: 3_600_000 },
    ]) {
      const length = await lengthOf(smuggled);
      expect(length).toBeLessThanOrEqual(TIERS.AUTHENTICATED.maxCallMs);
    }
  });

  it("does not accept a tier it has never heard of", async () => {
    // An unknown word is not a longer call. It is a lookup that misses, and the
    // miss must not become an unbounded session.
    await expect(lengthOf({ tier: "UNLIMITED" })).rejects.toThrow();
  });
});
