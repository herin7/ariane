import { resolveIntent, type GraphData } from "@ariane/core";
import { VoiceBroker } from "../broker";
import { VoiceSessions } from "../session";
import { memoryStore } from "../store";
import { setVoiceSinks } from "../telemetry";
import type { ToolResult, VoiceSession } from "../types";

/**
 * A graph small enough to reason about, in the shape of a real one.
 *
 * Not the seed. These tests are about the broker, and a test that fails because
 * somebody corrected a fee in Supabase is a test nobody trusts. Two documents,
 * one of them conditional so the compiler has a question to ask, and enough
 * metadata that a projection has a fee and a timeline to ground.
 */

const SOURCE = {
  id: "src:income",
  url: "https://example.gov.in/income-certificate",
  title: "Income Certificate",
  domain: "example.gov.in",
  sourceType: "SERVICE_PAGE" as const,
  jurisdictionId: "IN-GJ",
  retrievedAt: "2026-01-01",
};

const ref = [{ sourceId: SOURCE.id, evidence: "Fee Rs. 20. Issued within 7 days." }];

export const GRAPH: GraphData = {
  jurisdictions: [
    { id: "IN", level: "COUNTRY", name: "India" },
    { id: "IN-GJ", parentId: "IN", level: "STATE", name: "Gujarat" },
  ],
  sources: [SOURCE],
  nodes: [
    {
      id: "service:income_certificate",
      type: "SERVICE",
      name: "Income Certificate",
      officialName: "Aavak nu Dakhlo",
      jurisdictionId: "IN-GJ",
      metadata: {
        fee: "Rs. 20",
        timeline: "7 days",
        whatToDo: "Apply at the taluka office with proof of income",
      },
      sources: ref,
    },
    {
      id: "service:caste_certificate",
      type: "SERVICE",
      name: "Caste Certificate",
      jurisdictionId: "IN-GJ",
      metadata: { fee: "Rs. 50" },
      sources: ref,
    },
    {
      id: "document:aadhaar",
      type: "DOCUMENT",
      name: "Aadhaar card",
      jurisdictionId: "IN",
      metadata: { selfProvided: true },
      sources: ref,
    },
    {
      id: "document:ration_card",
      type: "DOCUMENT",
      name: "Ration card",
      jurisdictionId: "IN-GJ",
      metadata: { selfProvided: true },
      sources: ref,
    },
  ],
  edges: [
    {
      id: "edge:income_needs_aadhaar",
      from: "service:income_certificate",
      to: "document:aadhaar",
      type: "REQUIRES",
      verificationStatus: "VERIFIED",
      sources: ref,
    },
    {
      // Conditional on a fact nobody has given us, so the compiler asks.
      id: "edge:income_needs_ration",
      from: "service:income_certificate",
      to: "document:ration_card",
      type: "REQUIRES",
      verificationStatus: "VERIFIED",
      condition: { field: "household_size", operator: "GTE", value: 4 },
      sources: ref,
    },
    {
      id: "edge:caste_needs_aadhaar",
      from: "service:caste_certificate",
      to: "document:aadhaar",
      type: "REQUIRES",
      verificationStatus: "VERIFIED",
      sources: ref,
    },
  ],
  requirementGroups: [],
  questions: [
    {
      field: "household_size",
      label: "How many people live in your household?",
      inputType: "NUMBER",
    },
  ],
};

// Tests assert on refusals, not on log output. §19's console sink would print
// one line per tool call across the whole suite.
setVoiceSinks([]);

export interface Harness {
  store: ReturnType<typeof memoryStore>;
  sessions: VoiceSessions;
  broker: VoiceBroker;
  /** Open a browser session. The default caller: nobody, anonymous. */
  open(input?: { rawPhone?: string }): Promise<VoiceSession>;
  /** Propose a tool call, the way the model would. */
  call(session: VoiceSession, name: string, args?: unknown): Promise<ToolResult>;
}

export function harness(): Harness {
  const store = memoryStore();
  const sessions = new VoiceSessions({ store, secret: "test-session-secret", phoneSecret: "test-phone-secret" });
  const broker = new VoiceBroker({
    sessions,
    store,
    graph: async () => GRAPH,
    // The real chain's first pass, without the two that hold API keys.
    resolveNeed: async (graph, text) => ({ matches: resolveIntent(graph, text) }),
  });

  let n = 0;
  return {
    store,
    sessions,
    broker,
    async open(input = {}) {
      const created = await sessions.create({
        provider: input.rawPhone ? "VAPI" : "BROWSER",
        providerCallId: input.rawPhone ? `call_${++n}` : undefined,
        rawPhone: input.rawPhone,
        jurisdiction: { country: "IN", state: "GJ" },
      });
      if (!created.ok) throw new Error(`session refused: ${created.code}`);
      return created.session;
    },
    async call(session, name, args) {
      return broker.execute(session, { callId: `tc_${++n}`, name, arguments: args });
    },
  };
}

/** A citizen who has called before and agreed to be remembered. */
export async function returningCitizen(h: Harness, rawPhone: string) {
  const probe = await h.open({ rawPhone });
  const hash = probe.callerHash!;
  const citizen = await h.store.createCitizen(hash);
  await h.store.setConsent(citizen.id, "GRANTED");
  await h.sessions.end(probe);
  return { citizenId: citizen.id, callerHash: hash };
}
