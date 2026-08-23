import { describe, expect, it } from "vitest";
import { bedrockConfigFromEnv, pickService, type ServiceChoice } from "../lang/bedrock";

/**
 * No network. The one property worth defending is that the model cannot put a
 * service into the answer that is not already in the graph, so most of this
 * file is about ignoring the model rather than calling it.
 */

const CONFIG = { token: "t", model: "m", baseUrl: "https://example.invalid/anthropic", workspaceId: "default" };
const CANDIDATES: ServiceChoice[] = [
  { id: "service:income_certificate", name: "Income certificate", aliases: ["aavak no dakhlo"] },
  { id: "service:learner_licence", name: "Learner licence" },
];

const replies = (text: string) =>
  (async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 })) as never;

describe("pickService", () => {
  it("returns the id when the model picks one we offered", async () => {
    const picked = await pickService("paisa ka proof chahiye", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("service:income_certificate"),
    });
    expect(picked).toBe("service:income_certificate");
  });

  it("throws away an id that is not in the graph", async () => {
    // The failure this exists for: a fluent, plausible, entirely invented
    // service. It must be indistinguishable from the model being down.
    const picked = await pickService("passport", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("service:passport_renewal"),
    });
    expect(picked).toBeUndefined();
  });

  it("takes NONE for an answer", async () => {
    const picked = await pickService("book a flight", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("NONE"),
    });
    expect(picked).toBeUndefined();
  });

  it("ignores a chatty answer rather than trying to parse an id out of it", async () => {
    const picked = await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("I think it is service:income_certificate, probably."),
    });
    expect(picked).toBeUndefined();
  });

  it("does not call the network without credentials", async () => {
    let called = false;
    const picked = await pickService("anything", CANDIDATES, {
      config: undefined,
      fetchImpl: (() => { called = true; throw new Error("should not be called"); }) as never,
    });
    expect(called).toBe(false);
    expect(picked).toBeUndefined();
  });

  it("swallows the 403 the account currently gets, so intent resolution still answers", async () => {
    const picked = await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      fetchImpl: (async () => new Response("not available for this account", { status: 403 })) as never,
    });
    expect(picked).toBeUndefined();
  });

  it("gives up rather than making a citizen wait", async () => {
    const picked = await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      timeoutMs: 10,
      fetchImpl: ((_: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as never,
    });
    expect(picked).toBeUndefined();
  });

  it("sends every candidate id, because the model can only pick what it was shown", async () => {
    let body = "";
    await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      fetchImpl: ((_: string, init: RequestInit) => {
        body = String(init.body);
        return Promise.resolve(new Response(JSON.stringify({ content: [] }), { status: 200 }));
      }) as never,
    });
    for (const c of CANDIDATES) expect(body).toContain(c.id);
  });
});

describe("bedrockConfigFromEnv", () => {
  it("needs both a token and a model id, not one of them", () => {
    expect(bedrockConfigFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "t" })).toBeUndefined();
    expect(bedrockConfigFromEnv({ BEDROCK_MODEL_ID: "m" })).toBeUndefined();
    expect(bedrockConfigFromEnv({})).toBeUndefined();
  });

  it("defaults the workspace and the endpoint so .env only carries the secret", () => {
    const config = bedrockConfigFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "t", BEDROCK_MODEL_ID: "m" });
    expect(config).toEqual({
      token: "t",
      model: "m",
      baseUrl: "https://bedrock-mantle.us-east-1.api.aws/anthropic",
      workspaceId: "default",
    });
  });
});
