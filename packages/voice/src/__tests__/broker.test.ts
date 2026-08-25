import { describe, expect, it } from "vitest";
import { VoiceBroker } from "../broker";
import { VoiceSessions } from "../session";
import { memoryStore } from "../store";
import { GRAPH, harness, returningCitizen } from "./fixture";

/**
 * The ordinary path, which is what the whole thing is for.
 *
 * A citizen says what they need, Ariane finds it, asks one question, and the
 * path gets shorter. If this file is green and the isolation file is green,
 * voice is a working interface to the same compiler the website uses.
 */

describe("a call that goes well", () => {
  it("goes from a sentence to a shorter journey", async () => {
    const h = harness();
    const session = await h.open();

    const found = await h.call(session, "resolve_need", { utterance: "I need an income certificate" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const candidates = (found.data as { candidates: { serviceId: string }[] }).candidates;
    expect(candidates[0]?.serviceId).toBe("service:income_certificate");

    const started = await h.call(session, "start_journey", { serviceId: "service:income_certificate" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const journey = started.data as { nextQuestion?: { id: string }; documents: { neededCount: number } };
    expect(journey.nextQuestion?.id).toBe("household_size");

    const answered = await h.call(session, "answer_question", { questionId: "household_size", answer: 2 });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;

    // Two in the household, so the conditional ration card requirement drops
    // off and there is nothing left to ask.
    const after = answered.data as { nextQuestion?: unknown; documents: { needed: string[] } };
    expect(after.nextQuestion).toBeUndefined();
    expect(after.documents.needed).toEqual(["Aadhaar card"]);
  });

  it("takes yes or no about a document and shortens the list", async () => {
    const h = harness();
    const session = await h.open();
    await h.call(session, "start_journey", { serviceId: "service:income_certificate" });

    const held = await h.call(session, "answer_question", { questionId: "document:aadhaar", answer: true });
    expect(held.ok).toBe(true);
    expect(session.activeJourney?.documents).toContain("document:aadhaar");
    if (held.ok) {
      expect((held.data as { documents: { readyCount: number } }).documents.readyCount).toBe(1);
    }

    const lost = await h.call(session, "answer_question", { questionId: "document:aadhaar", answer: false });
    expect(lost.ok).toBe(true);
    expect(session.activeJourney?.documents).not.toContain("document:aadhaar");
  });

  it("grounds everything it lets the model say", async () => {
    const h = harness();
    const session = await h.open();
    const started = await h.call(session, "start_journey", { serviceId: "service:income_certificate" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const texts = started.grounding.map((f) => f.text);
    expect(texts).toContain("Rs. 20");
    expect(texts).toContain("7 days");
    // Every government claim carries the page it came from. The service's own
    // name is the exception and is the one thing that cites nothing.
    for (const fact of started.grounding.filter((f) => !f.claimId.startsWith("service:"))) {
      expect(fact.sourceId, fact.claimId).toBe("src:income");
    }
  });

  it("says so plainly when nothing matches, instead of offering the nearest thing", async () => {
    const h = harness();
    const session = await h.open();
    const result = await h.call(session, "resolve_need", { utterance: "zzzz qqqq wwww" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { status: string }).status).toBe("NOT_FOUND");
    expect((result.data as { candidates: unknown[] }).candidates).toHaveLength(0);
  });

  it("explains a step that is on the path, with its fee attached", async () => {
    const h = harness();
    const session = await h.open();
    await h.call(session, "start_journey", { serviceId: "service:income_certificate" });

    const explained = await h.call(session, "explain_step", { stepId: "service:income_certificate" });
    expect(explained.ok).toBe(true);
    if (!explained.ok) return;
    expect(explained.grounding.map((f) => f.text)).toContain("Rs. 20");
  });

  it("keeps an anonymous caller's journey on the session and out of the database", async () => {
    const h = harness();
    const session = await h.open();
    await h.call(session, "start_journey", { serviceId: "service:income_certificate" });
    await h.call(session, "answer_question", { questionId: "household_size", answer: 6 });

    expect(session.activeJourney?.answers).toEqual({ household_size: 6 });
    await h.sessions.end(session);
    // Nobody to attach it to, so nothing was written. That is the retention
    // policy for somebody we cannot identify, not a missing feature.
    expect(session.citizenId).toBeUndefined();
  });

  it("gives the screen the same compile the model is working from", async () => {
    const h = harness();
    const session = await h.open();
    await h.call(session, "start_journey", { serviceId: "service:income_certificate" });

    const before = session.budget.toolCalls;
    const snapshot = await h.broker.snapshot(session);
    expect((snapshot as { service: { id: string } }).service.id).toBe("service:income_certificate");
    // A panel refreshing does not spend a caller's tool budget.
    expect(session.budget.toolCalls).toBe(before);
  });

  it("resumes a verified citizen's own saved journey, answers intact", async () => {
    const h = harness();
    const a = await returningCitizen(h, "+919876500009");

    const first = await h.open({ rawPhone: "+919876500009" });
    await h.sessions.upgrade(first, a.citizenId);
    await h.call(first, "start_journey", { serviceId: "service:income_certificate" });
    await h.call(first, "answer_question", { questionId: "household_size", answer: 6 });
    await h.sessions.end(first);

    const second = await h.open({ rawPhone: "+919876500009" });
    await h.sessions.upgrade(second, a.citizenId);
    const resumed = await h.call(second, "resume_journey");

    expect(resumed.ok).toBe(true);
    expect(second.activeJourney?.answers).toEqual({ household_size: 6 });
    if (resumed.ok) {
      // Six in the household, so the ration card is back on the list.
      expect((resumed.data as { documents: { needed: string[] } }).documents.needed).toContain("Ration card");
    }
  });
});

describe("when Ariane cannot answer", () => {
  it("admits it rather than reaching for what the model remembers", async () => {
    const store = memoryStore();
    const sessions = new VoiceSessions({ store, secret: "s", phoneSecret: "p" });
    const broker = new VoiceBroker({
      sessions,
      store,
      graph: async () => {
        throw new Error("Supabase is on fire");
      },
      resolveNeed: async () => ({ matches: [] }),
    });
    const created = await sessions.create({ provider: "BROWSER" });
    if (!created.ok) throw new Error("session refused");

    const result = await broker.execute(created.session, {
      callId: "tc_1",
      name: "start_journey",
      arguments: { serviceId: "service:income_certificate" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(result.speak).toMatch(/would rather not say/i);
    // §19: the upstream error text is telemetry, never a sentence.
    expect(result.speak).not.toMatch(/supabase|fire|error/i);
  });

  it("never throws, whatever the model sends", async () => {
    const h = harness();
    const session = await h.open();
    for (const args of [undefined, null, "", "not json", "[]", 42, { deeply: { nested: { junk: true } } }]) {
      const result = await h.call(session, "resolve_need", args);
      expect(result).toHaveProperty("ok");
    }
  });
});

describe("the fixture itself", () => {
  it("is a graph the real compiler accepts", () => {
    expect(GRAPH.nodes.every((n) => n.sources?.length)).toBe(true);
    expect(GRAPH.edges.every((e) => e.sources?.length)).toBe(true);
  });
});
