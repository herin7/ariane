/**
 * Bedrock, for the citizen whose words share no tokens with any alias.
 *
 * "LLM UNDERSTANDS. GRAPH DECIDES." is the whole design and this file is the
 * narrow place the first half is allowed to happen. The model is handed the
 * list of service ids that already exist in the graph and asked to pick one of
 * them or say NONE. Its answer is then checked against that same list before
 * anybody believes it. A model that returns an id we did not offer is treated
 * exactly like a model that is down.
 *
 * It cannot invent a service, a requirement, a fee, an office or an order.
 * Those all come from rows with sources attached, and nothing here can reach
 * them.
 *
 * This is a fallback, not the front door. Token overlap runs first because it
 * is free, instant and auditable. This only runs when that finds nothing.
 *
 * Plain fetch on purpose. The Mantle endpoint is an HTTP POST with a bearer
 * token, and a whole SDK to build one JSON body is 800 lines of lockfile for
 * a function call.
 */

const DEFAULT_BASE = "https://bedrock-mantle.us-east-1.api.aws/anthropic";

export interface BedrockConfig {
  token: string;
  model: string;
  baseUrl: string;
  workspaceId: string;
}

export function bedrockConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): BedrockConfig | undefined {
  const token = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  const model = env.BEDROCK_MODEL_ID?.trim();
  if (!token || !model) return undefined;
  return {
    token,
    model,
    baseUrl: (env.BEDROCK_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
    workspaceId: env.BEDROCK_WORKSPACE_ID?.trim() || "default",
  };
}

/** Just enough of a SERVICE node to describe it to a model. */
export interface ServiceChoice {
  id: string;
  name: string;
  officialName?: string;
  aliases?: string[];
}

const SYSTEM = [
  "You map an Indian citizen's plain language description of a problem to exactly one government service id.",
  "You may only answer with an id from the list you are given, or the single word NONE.",
  "Answer NONE when the citizen is describing something not in the list. A wrong id sends someone to the wrong government office, NONE just asks them to rephrase.",
  "Reply with the id alone. No explanation, no punctuation, no formatting.",
].join(" ");

function catalogue(candidates: ServiceChoice[]): string {
  return candidates
    .map((c) => {
      const also = [c.officialName, ...(c.aliases ?? [])].filter(Boolean).slice(0, 8).join(", ");
      return also ? `${c.id} - ${c.name} (also called: ${also})` : `${c.id} - ${c.name}`;
    })
    .join("\n");
}

/**
 * One service id the graph already contains, or undefined.
 *
 * Undefined covers every failure the same way: no credentials, no model
 * access, a timeout, a refusal, a hallucinated id. The caller falls back to
 * asking the citizen to rephrase, which is the honest answer anyway.
 */
export async function pickService(
  text: string,
  candidates: ServiceChoice[],
  options: { config?: BedrockConfig; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string | undefined> {
  const query = text.trim();
  const config = options.config ?? bedrockConfigFromEnv();
  if (!query || !config || !candidates.length) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);

  try {
    const response = await (options.fetchImpl ?? fetch)(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        "anthropic-workspace-id": config.workspaceId,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 32,
        temperature: 0,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Services available:\n${catalogue(candidates)}\n\nCitizen said: ${query}\n\nWhich id?`,
          },
        ],
      }),
    });

    if (!response.ok) return undefined;

    const body = (await response.json()) as { content?: { type?: string; text?: string }[] };
    const answer = body.content?.find((c) => c.type === "text")?.text?.trim();
    if (!answer) return undefined;

    // The whole safety property, in one line: if it is not one of ours, it did
    // not happen.
    return candidates.some((c) => c.id === answer) ? answer : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
