import type { RealtimeSessionConfig } from "../agent";

/**
 * The browser leg. §5.
 *
 * The browser talks WebRTC straight to Azure AI Foundry, because that is what
 * makes interruption feel like interruption rather than like a walkie-talkie.
 * What it must never hold is a real API key, so this file mints a short-lived
 * client secret server side and hands over only that.
 *
 * The tool list and the instructions are set here too, at mint time, from the
 * session's identity level. A browser that edits its copy of the tool list gets
 * a model that proposes a tool the broker has never heard of.
 *
 * Foundry rather than OpenAI directly changes three things and nothing else:
 * the host is the deployment's own resource, `model` is a deployment name, and
 * the key travels in `api-key` rather than in `authorization`. The protocol
 * past the handshake is the same one, which is why nothing downstream of here
 * had to know.
 */

export interface EphemeralCredential {
  /** Short-lived, scoped to one realtime session. Safe to send to a browser. */
  value: string;
  expiresAt: number;
  model: string;
  /** Where the browser POSTs its SDP offer. Resource-specific, so it is told. */
  callUrl: string;
}

export class RealtimeNotConfiguredError extends Error {
  constructor() {
    super("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are not both set, so voice cannot connect");
    this.name = "RealtimeNotConfiguredError";
  }
}

/**
 * `https://<resource>.openai.azure.com` → the two GA realtime paths.
 *
 * Both live under `/openai/v1/`, and neither takes an `api-version`: that was
 * the preview protocol, which also used a separate regional host
 * (`<region>.realtimeapi-preview.ai.azure.com`) and is deprecated. If a sample
 * you are copying from has `?api-version=2025-04-01-preview` in it, it is the
 * old one.
 *
 * Known limit: a trailing slash in the env var is the whole normalisation. Parse
 * the URL properly when somebody pastes something stranger than that.
 */
const azureUrls = (endpoint: string) => {
  const base = endpoint.replace(/\/+$/, "");
  return {
    clientSecrets: `${base}/openai/v1/realtime/client_secrets`,
    calls: `${base}/openai/v1/realtime/calls`,
  };
};

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
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const key = env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !key) throw new RealtimeNotConfiguredError();
  const url = azureUrls(endpoint);

  /**
   * The resource key, not an Entra token.
   *
   * Foundry takes `Authorization: Bearer <Entra token>` here too, and a managed
   * identity is the better answer once this runs somewhere that has one. It is
   * strictly more code for the same request, so it waits until there is a
   * deployment to attach it to.
   */
  const response = await fetchImpl(url.clientSecrets, {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
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
    callUrl: url.calls,
  };
}

/** True when a browser voice session can be created at all. */
export const realtimeConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY);
