import { describe, expect, it } from "vitest";
import { harness, returningCitizen } from "./fixture";

/**
 * §27. Citizen A must never reach Citizen B, by any route.
 *
 * This is the release blocker. Everything else in this package is a quality
 * argument; this file is the one that decides whether a voice interface to
 * government is a thing we are allowed to ship. So the tests here are written
 * as attacks rather than as behaviours: each one is somebody trying, and the
 * assertion is that they got nothing.
 */

const PHONE_A = "+919876500001";
const PHONE_B = "+919876500002";

describe("cross-user isolation", () => {
  it("does not let B resume A's journey, even fully verified as themselves", async () => {
    const h = harness();

    // A saves a journey the ordinary way: verified, consenting, in progress.
    const a = await returningCitizen(h, PHONE_A);
    const sessionA = await h.open({ rawPhone: PHONE_A });
    await h.sessions.upgrade(sessionA, a.citizenId);
    await h.call(sessionA, "start_journey", { serviceId: "service:income_certificate" });
    await h.call(sessionA, "answer_question", { questionId: "household_size", answer: 5 });
    await h.sessions.end(sessionA);

    const saved = await h.store.latestJourney(a.citizenId);
    expect(saved?.serviceId).toBe("service:income_certificate");

    // B is a real, verified citizen. The strongest position an attacker can
    // legitimately reach, and it buys them their own empty history.
    const b = await returningCitizen(h, PHONE_B);
    const sessionB = await h.open({ rawPhone: PHONE_B });
    await h.sessions.upgrade(sessionB, b.citizenId);

    const resumed = await h.call(sessionB, "resume_journey");
    expect(resumed.ok).toBe(false);
    if (!resumed.ok) expect(resumed.code).toBe("NOT_FOUND");
    expect(JSON.stringify(resumed)).not.toContain(a.citizenId);
    expect(JSON.stringify(resumed)).not.toContain("income_certificate");
  });

  it("has nowhere for a caller to put somebody else's id, so saying one does nothing", async () => {
    const h = harness();
    const a = await returningCitizen(h, PHONE_A);
    const b = await returningCitizen(h, PHONE_B);

    const sessionB = await h.open({ rawPhone: PHONE_B });
    await h.sessions.upgrade(sessionB, b.citizenId);

    // Every shape a model could try. All of them are extra keys on a strict
    // schema, which is a parse error rather than an ignored field: ignored and
    // read-later are indistinguishable six months from now.
    for (const args of [
      { citizenId: a.citizenId },
      { citizen_id: a.citizenId },
      { userId: a.citizenId },
      { as: a.citizenId },
    ]) {
      const result = await h.call(sessionB, "resume_journey", args);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_ARGUMENTS");
    }

    // And the session is still B's, unshaken by four attempts.
    expect(sessionB.citizenId).toBe(b.citizenId);
  });

  it("erases only the citizen who asked", async () => {
    const h = harness();
    const a = await returningCitizen(h, PHONE_A);
    const b = await returningCitizen(h, PHONE_B);
    await h.store.savePreference(a.citizenId, "preferred_language", "gu");
    await h.store.savePreference(b.citizenId, "preferred_language", "hi");

    const sessionB = await h.open({ rawPhone: PHONE_B });
    await h.sessions.upgrade(sessionB, b.citizenId);
    const forgotten = await h.call(sessionB, "forget_my_data");
    expect(forgotten.ok).toBe(true);

    expect(await h.store.preferences(a.citizenId)).toEqual({ preferred_language: "gu" });
    expect(await h.store.citizenByCaller(a.callerHash)).toBeDefined();
    expect(await h.store.citizenByCaller(b.callerHash)).toBeUndefined();
  });

  it("drops the citizen off the session after erasure, so the call cannot reach the row it just deleted", async () => {
    const h = harness();
    const b = await returningCitizen(h, PHONE_B);
    const session = await h.open({ rawPhone: PHONE_B });
    await h.sessions.upgrade(session, b.citizenId);

    await h.call(session, "forget_my_data");

    expect(session.citizenId).toBeUndefined();
    expect(session.identityLevel).toBe("ANONYMOUS");
    const again = await h.call(session, "forget_my_data");
    expect(again.ok).toBe(false);
  });

  it("gives two different callers two different hashes and never the number", async () => {
    const h = harness();
    const a = await h.open({ rawPhone: PHONE_A });
    const b = await h.open({ rawPhone: PHONE_B });

    expect(a.callerHash).not.toBe(b.callerHash);
    for (const session of [a, b]) {
      const serialised = JSON.stringify(session);
      expect(serialised).not.toContain("9876500001");
      expect(serialised).not.toContain("9876500002");
    }
  });

  it("keeps a tool result free of the session's own secrets", async () => {
    const h = harness();
    const a = await returningCitizen(h, PHONE_A);
    const session = await h.open({ rawPhone: PHONE_A });
    await h.sessions.upgrade(session, a.citizenId);

    const started = await h.call(session, "start_journey", { serviceId: "service:income_certificate" });
    expect(started.ok).toBe(true);

    const body = JSON.stringify(started);
    expect(body).not.toContain(session.tokenHash);
    expect(body).not.toContain(session.callerHash);
    expect(body).not.toContain(a.citizenId);
  });

  it("will not answer a question on a journey the session does not have open", async () => {
    const h = harness();
    const a = await returningCitizen(h, PHONE_A);
    const sessionA = await h.open({ rawPhone: PHONE_A });
    await h.sessions.upgrade(sessionA, a.citizenId);
    await h.call(sessionA, "start_journey", { serviceId: "service:income_certificate" });

    // B never started anything. There is no journey id to pass and no argument
    // that takes one, so the only outcome available is "we have not opened
    // anything yet".
    const sessionB = await h.open({ rawPhone: PHONE_B });
    const answered = await h.call(sessionB, "answer_question", { questionId: "household_size", answer: 5 });
    expect(answered.ok).toBe(false);
    if (!answered.ok) expect(answered.code).toBe("NO_ACTIVE_JOURNEY");

    const current = await h.call(sessionB, "get_current_journey");
    expect(current.ok).toBe(false);
  });

  it("does not let a token from one session drive another", async () => {
    const h = harness();
    const first = await h.sessions.create({ provider: "BROWSER" });
    const second = await h.sessions.create({ provider: "BROWSER" });
    if (!first.ok || !second.ok) throw new Error("sessions should have been created");

    const crossed = await h.sessions.authenticate(second.session.id, first.issued.token);
    expect(crossed).toBe("NO_SESSION");
    expect(await h.sessions.authenticate(second.session.id, second.issued.token)).toMatchObject({
      id: second.session.id,
    });
  });
});
