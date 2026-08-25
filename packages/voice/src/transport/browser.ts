import type { RealtimeSessionConfig } from "../agent";

/**
 * The browser leg. §5.
 *
 * The browser talks WebRTC straight to OpenAI, because that is what makes
 * interruption feel like interruption rather than like a walkie-talkie. What it
 * must never hold is a real API key, so this file mints a short-lived client
 * secret server side and hands over only that.
 *
 * The tool list and the instructions are set here too, at mint time, from the
 * session's identity level. A browser that edits its copy of the tool list gets
 * a model that proposes a tool the broker has never heard of.
 */

export interface EphemeralCredential {
  /** Short-lived, scoped to one realtime session. Safe to send to a browser. */
  value: string;
  expiresAt: number;
  model: string;
}

export class RealtimeNotConfiguredError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not set, so voice cannot connect");
    this.name = "RealtimeNotConfiguredError";
  }
}

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

/**
 * A credential the browser may hold, valid for one call and a few minutes.
 *
 * Throws rather than degrading, and the route above turns that into an honest
 * "voice is not configured here". Every other capability in this repository has
 * a deterministic fallback; a voice call does not get one, because the fallback
 * for "cannot reach the model" is not a worse voice, it is no voice, and
 * pretending otherwise would be its own kind of invented answer.
 */
export async function mintClientSecret(
  config: RealtimeSessionConfig,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EphemeralCredential> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new RealtimeNotConfiguredError();

  const response = await fetchImpl(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: config.model,
        instructions: config.instructions,
        tools: config.tools,
        // Force the model to choose. Without this a caller can be left waiting
        // while it answers a fee question from its own head.
        tool_choice: "auto",
        audio: { ...config.audio, output: { voice: config.voice } },
      },
    }),
  });

  if (!response.ok) {
    // The provider's body can contain the key prefix and the org id. Neither is
    // ours to log, so the status is all that travels.
    throw new Error(`Realtime client secret request failed with ${response.status}`);
  }

  const body = (await response.json()) as { value?: string; expires_at?: number };
  if (!body.value) throw new Error("Realtime client secret response had no value");

  return {
    value: body.value,
    // The provider gives seconds. Everything in this package is milliseconds.
    expiresAt: body.expires_at ? body.expires_at * 1000 : Date.now() + 60_000,
    model: config.model,
  };
}

/** True when a browser voice session can be created at all. */
export const realtimeConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.OPENAI_API_KEY);
