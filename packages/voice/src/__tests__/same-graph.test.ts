import { compileJourney, resolveIntent } from "@ariane/core";
import { graphOrigin, loadGraph } from "@ariane/core/server";
import { describe, expect, it } from "vitest";
import { VoiceBroker } from "../broker";
import { VoiceSessions } from "../session";
import { memoryStore } from "../store";

/**
 * The voice agent and the web app answer out of one graph.
 *
 * Every other file here runs on `fixture.ts`, deliberately: those tests are
 * about the broker, and a broker test that fails because somebody corrected a
 * fee in Supabase is a test nobody trusts. But that leaves one thing unasserted
 * and it is the thing the data plane split could quietly break — that a citizen
 * on the phone reaches the same rows as a citizen on the website. A second
 * graph behind voice would pass every other suite in this directory.
 *
 * So this one file, and only this file, loads the real graph, and skips itself
 * on a clone that has none rather than asserting government facts against four
 * invented nodes about a tree. `pnpm gates:integration` is where it runs.
 */
const real = graphOrigin() !== "fixture";
const when = real ? describe : describe.skip;
if (!real) console.log("same-graph.test.ts: no snapshot on disk, skipping. `pnpm data:sync` to include it.");

when("voice reads the same graph the web app does", () => {
  const graph = loadGraph();
  const sessions = new VoiceSessions({ store: memoryStore(), secret: "s".repeat(64), phoneSecret: "p".repeat(64) });
  const broker = new VoiceBroker({
    store: memoryStore(),
    sessions,
    graph: async () => graph,
    resolveNeed: async (g, text) => ({ matches: resolveIntent(g, text) }),
  });

  const session = async () => {
    const created = await sessions.create({
      provider: "BROWSER",
      jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
      language: "en",
    });
    if (!created.ok) throw new Error(created.code);
    return created.session;
  };

  const call = async (name: string, args: Record<string, unknown>) =>
    broker.execute(await session(), { id: `t-${name}`, name, arguments: args } as never);

  it("has the production graph, not the fixture", () => {
    expect(graph.nodes.filter((n) => n.type === "SERVICE").length).toBeGreaterThan(400);
  });

  it("resolves a spoken Gujarati need against the production rows", async () => {
    const result = (await call("resolve_need", { utterance: "aavak nu dakhlo" })) as {
      ok: boolean;
      data?: { candidates?: { serviceId: string }[] };
    };
    expect(result.ok).toBe(true);
    expect(result.data?.candidates?.map((c) => c.serviceId)).toContain("service:income_certificate");
  });

  it("compiles the journey the compile endpoint would return for the same goal", async () => {
    const goal = "service:income_certificate";
    const web = compileJourney(graph, {
      goal,
      jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
    });
    const spoken = (await call("start_journey", { serviceId: goal })) as {
      ok: boolean;
      data?: { stepsRemaining?: number; nextBestAction?: { stepId?: string } };
    };
    expect(spoken.ok).toBe(true);
    expect(spoken.data?.stepsRemaining).toBe(web.summary.stepsRemaining);
    expect(spoken.data?.nextBestAction?.stepId).toBe(web.orderedSteps[0]?.nodeId);
  });

  it("still refuses a tool nobody gave it, on the real graph as on the fixture", async () => {
    const result = (await call("execute_sql", { query: "select 1" })) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe("UNKNOWN_TOOL");
  });
});
