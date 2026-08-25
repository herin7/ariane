import { redact } from "./guardrails";
import type { VoiceEvent, VoiceEventName } from "./types";

/**
 * What we are allowed to know about a call afterwards. §19, §20.
 *
 * The list of things not logged is longer than the list of things logged and
 * that is the design: a phone number, a transcript, an Aadhaar, a memory
 * payload and a system prompt are all more useful to an attacker than they are
 * to us. Every `detail` goes through `redact` on the way in, at the emitter
 * rather than at the sink, so adding a new sink cannot accidentally add a new
 * leak.
 *
 * Console by default because this repository already logs to console and §20
 * says prefer the existing logging first. Langfuse is a sink you configure, not
 * a dependency you inherit.
 */

export type VoiceSink = (event: VoiceEvent) => void;

let sinks: VoiceSink[] = [];

/** Replace the sink list. Returns a function that puts back what was there. */
export function setVoiceSinks(next: VoiceSink[]): () => void {
  const previous = sinks;
  sinks = next;
  return () => {
    sinks = previous;
  };
}

export function emit(
  name: VoiceEventName,
  sessionId: string,
  detail?: Record<string, unknown>,
  callerHash?: string,
): void {
  const event: VoiceEvent = {
    name,
    at: Date.now(),
    sessionId,
    // Already a keyed hash by the time it gets here. Truncated again so a log
    // line cannot be joined back to a `voice_citizens` row by eye.
    ...(callerHash ? { callerHash: callerHash.slice(0, 8) } : {}),
    ...(detail ? { detail: redact(detail) as Record<string, unknown> } : {}),
  };
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // A broken sink never takes a call down with it.
    }
  }
}

/** One line per event, structured. What `pnpm dev` shows you. */
export const consoleSink: VoiceSink = (event) => {
  console.log(JSON.stringify(event));
};

/**
 * Langfuse, if and only if it is configured. §20: off by default.
 *
 * Deliberately fire-and-forget over plain fetch rather than the SDK. One POST
 * of an already-redacted object does not justify a dependency, and a failed
 * telemetry call must never be able to fail a citizen's phone call.
 */
export function langfuseSink(
  env: Record<string, string | undefined> = process.env,
): VoiceSink | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL;
  if (!publicKey || !secretKey || !baseUrl) return undefined;

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return (event) => {
    void fetch(`${baseUrl.replace(/\/+$/, "")}/api/public/ingestion`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
      body: JSON.stringify({
        batch: [
          {
            id: `${event.sessionId}:${event.at}:${event.name}`,
            type: "event-create",
            timestamp: new Date(event.at).toISOString(),
            body: {
              name: event.name,
              sessionId: event.sessionId,
              // `event.detail` was redacted at emit. Nothing is added here.
              metadata: event.detail ?? {},
            },
          },
        ],
      }),
    }).catch(() => {});
  };
}

/** The sinks a deployment actually gets, decided once at boot. */
export function defaultSinks(env: Record<string, string | undefined> = process.env): VoiceSink[] {
  const langfuse = langfuseSink(env);
  return [
    ...(env.ARIANE_VOICE_QUIET === "1" ? [] : [consoleSink]),
    ...(langfuse ? [langfuse] : []),
  ];
}
