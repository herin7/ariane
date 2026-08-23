import Constants from "expo-constants";
import type { CompiledJourney, Facts, IntentMatch } from "@ariane/core";

/**
 * The phone talks to the same four endpoints the website does.
 *
 * There is no rule logic on this side and there never will be. The compiler
 * runs on the server against the graph, the phone renders what comes back.
 * Two implementations of the same rules is two answers to the same question,
 * and only one of them is right.
 */

/**
 * Where the API lives.
 *
 * `localhost` on a phone is the phone. Expo already knows the dev machine's
 * address on the network because that is how it served the bundle, so borrow
 * it rather than making somebody type an IP into a file every time the wifi
 * hands out a new lease. EXPO_PUBLIC_API_URL overrides it for a real deploy.
 */
export const API = (() => {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
})();

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error((json as { error?: string }).error ?? "Something went wrong");
  return json as T;
}

export interface Resolved {
  query: string;
  matches: IntentMatch[];
  /** Set when Sarvam translated the question. Shown so the citizen can correct us. */
  understoodAs?: string;
  detectedLanguage?: string;
  /** Set when a model read the intent out of a sentence rather than matching words. */
  inferred?: boolean;
}

export const resolveIntent = (text: string) => post<Resolved>("/api/intents/resolve", { text });

export const compileJourney = (goal: string, district: string, answers: Facts, documents: string[]) =>
  post<CompiledJourney>("/api/journeys/compile", {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district },
    citizen: { answers, documents },
  });
