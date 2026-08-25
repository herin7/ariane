import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callerHash, hashPhone, initialIdentityLevel, normalisePhone, stubCodeFor, stubStepUp } from "../identity";
import { RealtimeNotConfiguredError, mintClientSecret, realtimeConfigured } from "../transport/browser";
import { parseVapiEvent, vapiToolResponse, verifyVapiSignature } from "../transport/vapi";
import { harness } from "./fixture";

/**
 * The two doors into this package: a phone number arriving from a provider, and
 * a webhook claiming to be that provider. Both are outside the trust boundary,
 * so both get tested as if somebody is lying.
 */

const SECRET = "webhook-secret";
const NOW = 1_780_000_000_000;

const sign = (body: string, at = NOW, secret = SECRET) =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;

describe("phone numbers", () => {
  it("puts an Indian number in E.164 however it was dialled", () => {
    for (const raw of ["9876543210", "+919876543210", "919876543210", "09876543210", "0091 98765 43210", "+91 98765-43210"]) {
      expect(normalisePhone(raw), raw).toBe("+919876543210");
    }
  });

  it("returns nothing rather than guessing at what is not a number", () => {
    for (const raw of ["", "hello", "12345", "+1", "9876543210".repeat(3), "'; drop table voice_citizens; --"]) {
      expect(normalisePhone(raw), raw).toBeUndefined();
    }
  });

  it("keeps a foreign number as dialled instead of pretending it is Indian", () => {
    expect(normalisePhone("+14155550100")).toBe("+14155550100");
  });

  it("hashes the same number to the same value and a different key to a different one", () => {
    const a = hashPhone("+919876543210", "key-one");
    expect(hashPhone("+919876543210", "key-one")).toBe(a);
    expect(hashPhone("+919876543210", "key-two")).not.toBe(a);
    expect(a).toHaveLength(32);
    expect(a).not.toContain("9876543210");
  });

  it("hashes every spelling of one number to one row", () => {
    const forms = ["9876543210", "+919876543210", "0091-98765-43210"];
    expect(new Set(forms.map((f) => callerHash(f, "k"))).size).toBe(1);
  });

  it("refuses to hash without a key, rather than falling back to a plain digest", () => {
    // An unkeyed SHA-256 of a ten digit mobile is a lookup table, not a hash.
    expect(() => hashPhone("+919876543210", "")).toThrow(/required/i);
  });

  it("recognises a returning caller and stops there", () => {
    expect(initialIdentityLevel({ callerHash: "h", citizenId: "c" })).toBe("RECOGNIZED");
    expect(initialIdentityLevel({ callerHash: "h" })).toBe("ANONYMOUS");
    expect(initialIdentityLevel({})).toBe("ANONYMOUS");
  });
});

describe("step up", () => {
  const env = { ARIANE_VOICE_STUB_STEPUP: "1", NODE_ENV: "test" };

  it("will not switch itself on in production, or without being asked", () => {
    expect(() => stubStepUp({ ...env, NODE_ENV: "production" })).toThrow();
    expect(() => stubStepUp({ NODE_ENV: "test" })).toThrow();
  });

  it("takes the right code once and never again", async () => {
    const provider = stubStepUp(env);
    const { challengeId } = await provider.challenge("caller-hash");
    expect(await provider.verify(challengeId, stubCodeFor("caller-hash"))).toBe(true);
    // Consumed. A code that stays valid is a code worth stealing.
    expect(await provider.verify(challengeId, stubCodeFor("caller-hash"))).toBe(false);
  });

  it("burns the challenge on a wrong code, so there is nothing to brute force", async () => {
    const provider = stubStepUp(env);
    const { challengeId } = await provider.challenge("caller-hash");
    expect(await provider.verify(challengeId, "000000")).toBe(false);
    // One guess per SMS. Harsher than a real OTP, which allows two or three,
    // and the harsher one is the right default for a stub: whoever writes the
    // real provider has to add attempts on purpose rather than inherit them.
    expect(await provider.verify(challengeId, stubCodeFor("caller-hash"))).toBe(false);
  });

  it("does not verify a challenge that was never issued", async () => {
    const provider = stubStepUp(env);
    expect(await provider.verify("made-up", stubCodeFor("caller-hash"))).toBe(false);
  });

  it("does not accept another caller's code", async () => {
    const provider = stubStepUp(env);
    const { challengeId } = await provider.challenge("caller-a");
    expect(await provider.verify(challengeId, stubCodeFor("caller-b"))).toBe(false);
  });
});

describe("the vapi webhook", () => {
  const body = JSON.stringify({ message: { type: "status-update", call: { id: "call_1" } } });

  it("accepts a payload signed with the shared secret", () => {
    expect(verifyVapiSignature({ body, headers: { "x-vapi-signature": sign(body) }, secret: SECRET, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("rejects a payload altered after signing", () => {
    const signature = sign(body);
    const tampered = body.replace("call_1", "call_2");
    expect(verifyVapiSignature({ body: tampered, headers: { "x-vapi-signature": signature }, secret: SECRET, now: NOW })).toEqual(
      { ok: false, reason: "bad-signature" },
    );
  });

  it("rejects a signature made with a different secret", () => {
    const forged = sign(body, NOW, "guessed");
    expect(verifyVapiSignature({ body, headers: { "x-vapi-signature": forged }, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("closes the replay window in both directions", () => {
    const withinWindow = { ok: true };
    const stale = { ok: false, reason: "stale-timestamp" };
    const at = (offset: number) =>
      verifyVapiSignature({ body, headers: { "x-vapi-signature": sign(body, NOW + offset) }, secret: SECRET, now: NOW });

    expect(at(0)).toEqual(withinWindow);
    expect(at(-4 * 60_000)).toEqual(withinWindow); // a retry across a blip
    expect(at(60_000)).toEqual(withinWindow); // their clock runs ahead
    expect(at(-6 * 60_000)).toEqual(stale); // yesterday's capture
    expect(at(6 * 60_000)).toEqual(stale);
  });

  it("rejects an unsigned request, a malformed one, and one with no secret configured", () => {
    expect(verifyVapiSignature({ body, headers: {}, secret: SECRET })).toEqual({ ok: false, reason: "unsigned" });
    expect(verifyVapiSignature({ body, headers: { "x-vapi-signature": "v1=abc" }, secret: SECRET })).toMatchObject({
      ok: false,
    });
    expect(verifyVapiSignature({ body, headers: { "x-vapi-signature": sign(body) }, secret: "" })).toEqual({
      ok: false,
      reason: "no-secret-configured",
    });
  });

  it("takes the bearer header form, and only the right value", () => {
    expect(verifyVapiSignature({ body, headers: { "x-vapi-secret": SECRET }, secret: SECRET })).toEqual({ ok: true });
    expect(verifyVapiSignature({ body, headers: { "x-vapi-secret": "nope" }, secret: SECRET })).toEqual({
      ok: false,
      reason: "bad-secret",
    });
  });

  it("reads headers out of a real Headers object too", () => {
    const headers = new Headers({ "X-Vapi-Signature": sign(body) });
    expect(verifyVapiSignature({ body, headers, secret: SECRET, now: NOW })).toEqual({ ok: true });
  });

  it("turns a tool-calls payload into this package's own vocabulary", () => {
    const event = parseVapiEvent({
      message: {
        type: "tool-calls",
        call: { id: "call_9", customer: { number: "+919876543210" } },
        toolCalls: [{ id: "tc_1", function: { name: "resolve_need", arguments: { utterance: "income certificate" } } }],
      },
    });

    expect(event).toMatchObject({
      type: "tool-calls",
      providerCallId: "call_9",
      callerNumber: "+919876543210",
      ended: false,
    });
    expect(event?.toolCalls).toEqual([
      { callId: "tc_1", name: "resolve_need", arguments: { utterance: "income certificate" } },
    ]);
  });

  it("flags the end of a call and files anything unfamiliar as other", () => {
    expect(parseVapiEvent({ message: { type: "end-of-call-report", call: { id: "c" } } })?.ended).toBe(true);
    expect(parseVapiEvent({ message: { type: "some-new-vapi-event" } })?.type).toBe("other");
  });

  it("returns undefined for a payload that is not a webhook at all", () => {
    for (const payload of [null, "", 42, {}, { message: null }, { message: { call: { id: "c" } } }]) {
      expect(parseVapiEvent(payload)).toBeUndefined();
    }
  });

  it("answers in the shape vapi expects", () => {
    expect(vapiToolResponse([{ callId: "tc_1", result: "{}" }])).toEqual({
      results: [{ toolCallId: "tc_1", result: "{}" }],
    });
  });
});

describe("binding a call to a session", () => {
  it("will not let one call id drive another call's session", async () => {
    const h = harness();
    const first = await h.open({ rawPhone: "+919876500011" });
    const second = await h.open({ rawPhone: "+919876500012" });

    expect(await h.sessions.authenticateCall(second.id, first.providerCallId!)).toBe("NO_SESSION");
    expect(await h.sessions.authenticateCall(second.id, second.providerCallId!)).toMatchObject({ id: second.id });
  });

  it("will not let a browser session be driven by a call id", async () => {
    const h = harness();
    const browser = await h.open();
    expect(browser.providerCallId).toBeUndefined();
    expect(await h.sessions.authenticateCall(browser.id, "call_1")).toBe("NO_SESSION");
  });

  it("finds a call's session without being told the session id", async () => {
    const h = harness();
    const session = await h.open({ rawPhone: "+919876500013" });
    expect(await h.sessions.byProviderCall(session.providerCallId!)).toMatchObject({ id: session.id });
    expect(await h.sessions.byProviderCall("call_nobody")).toBeUndefined();
  });

  it("stops taking tool calls once the call has ended", async () => {
    const h = harness();
    const session = await h.open({ rawPhone: "+919876500014" });
    await h.sessions.end(session);
    expect(await h.sessions.authenticateCall(session.id, session.providerCallId!)).toBe("SESSION_ENDED");
  });
});

/**
 * The third door: the credential the browser is handed. Azure AI Foundry is a
 * per-resource host and a deployment name, so the two things worth asserting
 * are that the real key stays behind and that the URLs are the GA ones - the
 * preview protocol used a different host entirely and fails in a way that
 * looks like a network problem.
 */
describe("minting a browser credential", () => {
  const CONFIG = { model: "ariane-realtime", instructions: "be brief", tools: [], voice: "marin", audio: {} };
  const ENV = { AZURE_OPENAI_ENDPOINT: "https://ariane.openai.azure.com/", AZURE_OPENAI_API_KEY: "real-key" };

  const spy = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ value: "ek_abc", expires_at: NOW / 1000 }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it("asks the deployment's own resource, on the GA paths", async () => {
    const { calls, impl } = spy();
    const credential = await mintClientSecret(CONFIG, ENV, impl);

    // The trailing slash in the env var is the one that bites.
    expect(calls[0]!.url).toBe("https://ariane.openai.azure.com/openai/v1/realtime/client_secrets");
    expect(calls[0]!.url).not.toContain("api-version");
    expect(credential.callUrl).toBe("https://ariane.openai.azure.com/openai/v1/realtime/calls");
    expect(credential).toMatchObject({ value: "ek_abc", model: "ariane-realtime", expiresAt: NOW });
  });

  it("sends the resource key as api-key and never as something the browser sees", async () => {
    const { calls, impl } = spy();
    const credential = await mintClientSecret(CONFIG, ENV, impl);

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("real-key");
    expect(headers.authorization).toBeUndefined();
    expect(JSON.stringify(credential)).not.toContain("real-key");

    // The deployment name, the instructions and the tool list are all decided
    // here rather than by whoever is holding the credential.
    expect(JSON.parse(calls[0]!.init.body as string).session).toMatchObject({
      type: "realtime",
      model: "ariane-realtime",
      instructions: "be brief",
      tool_choice: "auto",
      audio: { output: { voice: "marin" } },
    });
  });

  it("refuses rather than half-configuring itself", async () => {
    const { impl } = spy();
    for (const env of [{}, { AZURE_OPENAI_ENDPOINT: ENV.AZURE_OPENAI_ENDPOINT }, { AZURE_OPENAI_API_KEY: "k" }]) {
      expect(realtimeConfigured(env)).toBe(false);
      await expect(mintClientSecret(CONFIG, env, impl)).rejects.toBeInstanceOf(RealtimeNotConfiguredError);
    }
    expect(realtimeConfigured(ENV)).toBe(true);
  });

  it("does not put the provider's error body in ours", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ error: { message: "key sk-live-42 is over quota for org-ariane" } }), {
        status: 429,
      })) as unknown as typeof fetch;

    await expect(mintClientSecret(CONFIG, ENV, impl)).rejects.toThrow(/429/);
    await expect(mintClientSecret(CONFIG, ENV, impl)).rejects.not.toThrow(/sk-live|org-ariane/);
  });
});
