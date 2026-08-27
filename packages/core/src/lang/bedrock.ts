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
 * Route notes, because they cost an afternoon. `bedrock-mantle` serves the
 * OpenAI shaped API at `/v1/chat/completions` with an `openai-project` header,
 * and the Anthropic shaped one at `/anthropic/v1/messages` with an
 * `anthropic-workspace-id` header. Every non Anthropic model in the catalogue
 * lives on the first. `GET /v1/models` lists what the account can actually
 * call, which is the question we spent a long time guessing at.
 *
 * Plain fetch on purpose. This is one HTTP POST with a bearer token, and a
 * whole SDK to build one JSON body is 800 lines of lockfile for a function
 * call.
 */

const DEFAULT_BASE = "https://bedrock-mantle.us-east-1.api.aws";

/**
 * Scored 8/8 on the intent cases at about 650ms, including the Hindi and
 * Gujarati ones. Override with BEDROCK_MODEL_ID. `GET /v1/models` on the same
 * host lists the alternatives.
 */
const DEFAULT_MODEL = "moonshotai.kimi-k2.5";

export interface BedrockConfig {
  token: string;
  model: string;
  baseUrl: string;
  project: string;
}

export function bedrockConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): BedrockConfig | undefined {
  const token = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (!token) return undefined;
  return {
    token,
    model: env.BEDROCK_MODEL_ID?.trim() || DEFAULT_MODEL,
    baseUrl: (env.BEDROCK_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
    project: env.BEDROCK_PROJECT?.trim() || env.BEDROCK_WORKSPACE_ID?.trim() || "default",
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
 * The model's answer, resolved to one of our ids or nothing.
 *
 * Forgiving about shape, unforgiving about substance. Half the catalogue drops
 * the `service:` prefix and some of them wrap the id in backticks or a full
 * stop, and throwing away a correct answer over punctuation is just a worse
 * product. What it will not do is accept an id we did not offer, however
 * plausible it reads. That check is the entire safety property.
 */
function resolve(answer: string | undefined, candidates: ServiceChoice[]): string | undefined {
  // Ids are word characters and a colon. Anything else the model wrapped
  // around it, backticks or a full stop, is formatting and comes off.
  const last = answer?.trim().split(/\s+/).pop()?.replace(/[^\w:]/g, "");
  if (!last || /^none$/i.test(last)) return undefined;

  const wanted = last.toLowerCase();
  return candidates.find((c) => {
    const id = c.id.toLowerCase();
    return id === wanted || id === `service:${wanted}`;
  })?.id;
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
  options: BedrockCall = {},
): Promise<string | undefined> {
  const query = text.trim();
  if (!query || !candidates.length) return undefined;

  const answer = await bedrockChat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Services available:\n${catalogue(candidates)}\n\nCitizen said: ${query}\n\nWhich id?` },
    ],
    options,
  );
  return resolve(answer, candidates);
}

export interface BedrockCall {
  config?: BedrockConfig;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

/**
 * One chat completion, or undefined.
 *
 * Extracted from `pickService` when a second caller appeared, and undefined
 * still covers every failure the same way: no credentials, no model access, a
 * timeout, a refusal, a body in a shape we did not expect. Every caller of this
 * has to have an answer for "the model said nothing", because that is a normal
 * Tuesday, and one that throws instead would be a page of five hundreds.
 */
export async function bedrockChat(
  messages: { role: string; content: string }[],
  options: BedrockCall = {},
): Promise<string | undefined> {
  const config = options.config ?? bedrockConfigFromEnv();
  if (!config) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);

  try {
    const response = await (options.fetchImpl ?? fetch)(`${config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        "openai-project": config.project,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        // Generous, because several models in this catalogue think out loud
        // first and return an empty message if you cut them off mid thought.
        max_tokens: options.maxTokens ?? 800,
        temperature: 0,
        messages,
      }),
    });

    if (!response.ok) return undefined;

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
