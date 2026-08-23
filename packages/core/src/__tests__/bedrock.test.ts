import { describe, expect, it } from "vitest";
import { bedrockConfigFromEnv, pickService, type ServiceChoice } from "../lang/bedrock";

/**
 * No network. The one property worth defending is that the model cannot put a
 * service into the answer that is not already in the graph, so most of this
 * file is about ignoring the model rather than calling it.
 */

const CONFIG = { token: "t", model: "m", baseUrl: "https://example.invalid", project: "default" };
const CANDIDATES: ServiceChoice[] = [
  { id: "service:income_certificate", name: "Income certificate", aliases: ["aavak no dakhlo"] },
  { id: "service:learner_licence", name: "Learner licence" },
];

const replies = (content: string) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as never;

describe("pickService", () => {
  it("returns the id when the model picks one we offered", async () => {
    const picked = await pickService("paisa ka proof chahiye", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("service:income_certificate"),
    });
    expect(picked).toBe("service:income_certificate");
  });

  it("accepts the id without the service prefix, which half the catalogue drops", async () => {
    const picked = await pickService("aavak", CANDIDATES, { config: CONFIG, fetchImpl: replies("income_certificate") });
    expect(picked).toBe("service:income_certificate");
  });

  it("survives punctuation and formatting around a correct answer", async () => {
    for (const answer of ["`service:learner_licence`", "service:learner_licence.", "  LEARNER_LICENCE  "]) {
      expect(await pickService("scooter", CANDIDATES, { config: CONFIG, fetchImpl: replies(answer) })).toBe(
        "service:learner_licence",
      );
    }
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
    expect(await pickService("book a flight", CANDIDATES, { config: CONFIG, fetchImpl: replies("NONE") })).toBeUndefined();
  });

  it("does not mine an id out of a chatty answer", async () => {
    // Only the last token is read. A model that explains itself has not
    // followed the instruction, and guessing which id it meant is exactly the
    // kind of cleverness that sends somebody to the wrong office.
    const picked = await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      fetchImpl: replies("It is probably service:income_certificate but honestly who knows"),
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

  it("swallows a model the account cannot call, so intent resolution still answers", async () => {
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

  it("posts to the OpenAI shaped route with every candidate id in the body", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    let body = "";
    await pickService("aavak", CANDIDATES, {
      config: CONFIG,
      fetchImpl: ((target: string, init: RequestInit) => {
        url = target;
        headers = init.headers as Record<string, string>;
        body = String(init.body);
        return Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
      }) as never,
    });
    // Not /anthropic/v1/messages. Every non Anthropic model in the catalogue
    // rejects that route, which is the bug this test exists to keep fixed.
    expect(url).toBe("https://example.invalid/v1/chat/completions");
    expect(headers["openai-project"]).toBe("default");
    for (const c of CANDIDATES) expect(body).toContain(c.id);
  });
});

describe("bedrockConfigFromEnv", () => {
  it("needs a token and nothing else, because the rest has a sane default", () => {
    expect(bedrockConfigFromEnv({})).toBeUndefined();
    expect(bedrockConfigFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "   " })).toBeUndefined();
    expect(bedrockConfigFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "t" })).toEqual({
      token: "t",
      model: "moonshotai.kimi-k2.5",
      baseUrl: "https://bedrock-mantle.us-east-1.api.aws",
      project: "default",
    });
  });

  it("lets .env choose another model without touching code", () => {
    expect(bedrockConfigFromEnv({ AWS_BEARER_TOKEN_BEDROCK: "t", BEDROCK_MODEL_ID: "zai.glm-5" })?.model).toBe("zai.glm-5");
  });
});
