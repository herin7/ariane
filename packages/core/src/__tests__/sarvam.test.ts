import { describe, expect, it } from "vitest";
import { sarvamKeyFromEnv, understand } from "../lang/sarvam";

/**
 * No network. Every one of these is about what happens when Sarvam is missing,
 * slow or wrong, because that is the state the product ships in on a bad day
 * and the citizen still has to get an answer.
 */

const KEY = "test-key";
const ok = (translated_text: string, source_language_code = "gu-IN") =>
  (async () => new Response(JSON.stringify({ translated_text, source_language_code }), { status: 200 })) as never;

describe("understand", () => {
  it("does not call the network when there is no key", async () => {
    let called = false;
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", {
      key: undefined,
      fetchImpl: (() => { called = true; throw new Error("should not be called"); }) as never,
    });
    expect(called).toBe(false);
    expect(result.translated).toBe(false);
    expect(result.english).toBe("મારે આવકનો દાખલો જોઈએ છે");
  });

  it("does not call the network for Latin script, because the aliases already speak it", async () => {
    let called = false;
    const result = await understand("aavak nu dakhlo", {
      key: KEY,
      fetchImpl: (() => { called = true; throw new Error("should not be called"); }) as never,
    });
    expect(called).toBe(false);
    expect(result.english).toBe("aavak nu dakhlo");
  });

  it("translates Gujarati script and reports which language it was", async () => {
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", {
      key: KEY,
      fetchImpl: ok("I need an income certificate"),
    });
    expect(result.english).toBe("I need an income certificate");
    expect(result.detected).toBe("gu-IN");
    expect(result.translated).toBe(true);
    expect(result.original).toBe("મારે આવકનો દાખલો જોઈએ છે");
  });

  it("falls back to the citizen's own words when Sarvam errors", async () => {
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", {
      key: KEY,
      fetchImpl: (async () => new Response("nope", { status: 500 })) as never,
    });
    expect(result.english).toBe("મારે આવકનો દાખલો જોઈએ છે");
    expect(result.translated).toBe(false);
  });

  it("falls back when the network throws rather than propagating it", async () => {
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", {
      key: KEY,
      fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as never,
    });
    expect(result.translated).toBe(false);
  });

  it("gives up rather than making a citizen wait on a search box", async () => {
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", {
      key: KEY,
      timeoutMs: 10,
      fetchImpl: ((_: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as never,
    });
    expect(result.english).toBe("મારે આવકનો દાખલો જોઈએ છે");
    expect(result.translated).toBe(false);
  });

  it("treats an empty translation as no translation", async () => {
    const result = await understand("મારે આવકનો દાખલો જોઈએ છે", { key: KEY, fetchImpl: ok("   ") });
    expect(result.translated).toBe(false);
  });
});

describe("sarvamKeyFromEnv", () => {
  it("treats blank as absent, so a half filled .env behaves like an empty one", () => {
    expect(sarvamKeyFromEnv({ SARVAM_API_KEY: "   " })).toBeUndefined();
    expect(sarvamKeyFromEnv({})).toBeUndefined();
    expect(sarvamKeyFromEnv({ SARVAM_API_KEY: " abc " })).toBe("abc");
  });
});
