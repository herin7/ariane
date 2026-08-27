import { randomUUID } from "node:crypto";
import { supabaseClient, supabaseConfigFromEnv } from "@ariane/core/server";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceCapacity } from "../ops/capacity";
import { supabaseOps } from "../ops/store";
import { CAPACITY } from "../policy";

/**
 * The half of §18 that only Postgres can answer.
 *
 * `capacity.test.ts` proves the arithmetic. This proves the property the
 * arithmetic depends on: that thirty admission requests arriving at once
 * produce exactly ten leases. In a single Node process that is true by
 * accident — there is no await between the count and the insert — so the fake
 * store passes it for free and the assertion is worthless. Here the requests
 * are thirty separate transactions against a real server, which is the shape
 * Vercel actually produces.
 *
 *   pnpm --filter @ariane/voice test:pg
 *
 * Opt-in, and deliberately not part of `pnpm gates`. It writes real rows to
 * whatever database `.env` points at and briefly occupies real capacity, so it
 * is a thing an operator runs on purpose, not something a build does. Every row
 * it creates is tracked by id and deleted after each test.
 */

/**
 * Two conditions, both required.
 *
 * The flag comes from `pg-tests.env`, which only `test:pg` loads, so a CI
 * machine that happens to export `SUPABASE_URL` does not quietly start writing
 * leases during `pnpm gates`. The credentials come from the real `.env`, which
 * `test` does not load at all.
 */
const config = process.env.ARIANE_OPS_PG_TESTS === "1" ? supabaseConfigFromEnv() : undefined;
const when = config ? describe : describe.skip;

/**
 * Built here rather than inside the block: `describe.skip` still *collects* its
 * body, so anything constructed in there runs even when the suite is skipped.
 * A client built from an undefined config throws at collection time and fails
 * the whole file on a laptop with no credentials.
 */
const db = config ? supabaseClient(config) : undefined;

/**
 * Generous, because every assertion below is several round trips to a database
 * in Mumbai. Vitest's five second default is a unit-test number and this is not
 * one.
 */
const PG_TIMEOUT = 60_000;

when("capacity, against real Postgres", () => {
  const ops = supabaseOps(db!);
  const capacity = new VoiceCapacity(ops);

  /**
   * Everything this file creates, by id, cleared after every test.
   *
   * By id rather than by predicate: a `delete where ip_hash like 'pgtest%'` is
   * one typo away from ending somebody's live call. And after *every* test
   * rather than at the end, because the queue is a global FIFO — a leftover
   * ticket from the previous test sits ahead of this test's ticket in the same
   * line, and the promotion assertion then fails for a reason that has nothing
   * to do with the code.
   */
  let leases: string[] = [];
  let tickets: string[] = [];

  const session = () => {
    const id = randomUUID();
    leases.push(id);
    return id;
  };

  /** Take every line at once. Ten sequential round trips is most of a minute. */
  const fill = async () => {
    const held = Array.from({ length: CAPACITY.maxConcurrentCalls }, () => session());
    await Promise.all(
      held.map((sessionId) =>
        ops.admit({ sessionId, ipHash: "pgtest", ttlMs: 60_000, max: CAPACITY.maxConcurrentCalls }),
      ),
    );
    return held;
  };

  /**
   * Real traffic wins. These tests need an empty pool to start from, and
   * fighting a citizen for slot ten is not something a test gets to do.
   */
  const quiet = async () => {
    const live = await ops.activeLeases();
    if (live > 0) console.warn(`skipping: ${live} live call(s) in progress`);
    return live === 0;
  };

  afterEach(async () => {
    if (!db) return;
    if (leases.length) await db.from("voice_capacity_leases").delete().in("session_id", leases);
    if (tickets.length) await db.from("voice_queue").delete().in("id", tickets);
    leases = [];
    tickets = [];
  });

  it(
    "cannot be raced into an eleventh lease",
    async () => {
      if (!(await quiet())) return;

      const attempts = Array.from({ length: 30 }, () => session());
      const results = await Promise.all(
        attempts.map((sessionId) =>
          ops.admit({ sessionId, ipHash: "pgtest", ttlMs: 60_000, max: CAPACITY.maxConcurrentCalls }),
        ),
      );

      expect(results.filter((r) => r.admitted).length).toBe(CAPACITY.maxConcurrentCalls);
      expect(await ops.activeLeases()).toBe(CAPACITY.maxConcurrentCalls);
    },
    PG_TIMEOUT,
  );

  it(
    "promotes exactly one waiting caller per freed line, in order",
    async () => {
      if (!(await quiet())) return;
      const held = await fill();

      const first = await capacity.join({ ipHash: "pgtest-a" });
      // Distinct timestamps: `created_at` is the FIFO key, and two inserts in
      // the same microsecond would make the order arbitrary rather than wrong.
      await new Promise((r) => setTimeout(r, 25));
      const second = await capacity.join({ ipHash: "pgtest-b" });
      tickets.push(first.ticket, second.ticket);

      expect(first.view.position).toBe(1);
      expect(second.view.position).toBe(2);

      await ops.release(held[0]!);

      // Both poll at once, which is what two browsers on a two second timer do.
      const [a, b] = await Promise.all([capacity.poll(first.ticket), capacity.poll(second.ticket)]);
      expect(a.status).toBe("ADMITTED");
      expect(a.claimToken).toBeTruthy();
      expect(b.status).toBe("WAITING");

      // Not asserted on `b` above: the two polls are concurrent, so whether B
      // saw itself as second (A still waiting) or first (A already promoted)
      // depends on which transaction won, and both are correct. What must be
      // true is that one line freed promoted exactly one caller. Ask again,
      // now that the race has settled.
      expect((await capacity.poll(second.ticket)).position).toBe(1);
    },
    PG_TIMEOUT,
  );

  it(
    "counts a promoted-but-unclaimed slot as taken",
    async () => {
      if (!(await quiet())) return;
      const held = await fill();

      const waiting = await capacity.join({ ipHash: "pgtest-c" });
      tickets.push(waiting.ticket);
      await ops.release(held[0]!);
      expect((await capacity.poll(waiting.ticket)).status).toBe("ADMITTED");

      // The freed line belongs to the person who waited for it.
      const walkIn = await ops.admit({
        sessionId: session(),
        ipHash: "pgtest-walkin",
        ttlMs: 60_000,
        max: CAPACITY.maxConcurrentCalls,
      });
      expect(walkIn.admitted).toBe(false);
    },
    PG_TIMEOUT,
  );

  it(
    "will not hand a lease to a forged claim token",
    async () => {
      if (!(await quiet())) return;
      const held = await fill();

      const mine = await capacity.join({ ipHash: "pgtest-d" });
      tickets.push(mine.ticket);
      await ops.release(held[0]!);
      const promoted = await capacity.poll(mine.ticket);
      expect(promoted.status).toBe("ADMITTED");

      const stolen = await ops.queueClaim({
        ticket: mine.ticket,
        claimToken: "guessed",
        sessionId: session(),
        ttlMs: 60_000,
        max: CAPACITY.maxConcurrentCalls,
      });
      expect(stolen.admitted).toBe(false);

      const real = await ops.queueClaim({
        ticket: mine.ticket,
        claimToken: promoted.claimToken!,
        sessionId: session(),
        ttlMs: 60_000,
        max: CAPACITY.maxConcurrentCalls,
      });
      expect(real.admitted).toBe(true);
    },
    PG_TIMEOUT,
  );

  it(
    "charges a guest's minute once across both subjects",
    async () => {
      const subjects = [`guest:pgtest-${randomUUID()}`, `ip:pgtest-${randomUUID()}`];

      const first = await ops.guestConsume({ subjects, ms: 60_000, budgetMs: 60_000, windowSeconds: 86_400 });
      expect(first.allowed).toBe(true);

      // A cleared cookie presents only the second subject, and it is spent.
      const second = await ops.guestConsume({ subjects, ms: 60_000, budgetMs: 60_000, windowSeconds: 86_400 });
      expect(second.allowed).toBe(false);

      await db!.from("voice_guest_usage").delete().in("subject", subjects);
    },
    PG_TIMEOUT,
  );

  it(
    "counts a rate limit window atomically under concurrency",
    async () => {
      const key = `pgtest:${randomUUID()}`;
      const verdicts = await Promise.all(Array.from({ length: 20 }, () => ops.rateLimit(key, 60, 5)));

      expect(verdicts.filter((v) => v.allowed).length).toBe(5);
      // Twenty calls, twenty distinct counts. A lost update would repeat one.
      expect(new Set(verdicts.map((v) => v.count)).size).toBe(20);

      await db!.from("ariane_rate_limits").delete().eq("key", key);
    },
    PG_TIMEOUT,
  );
});
