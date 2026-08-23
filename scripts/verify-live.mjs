/**
 * End to end smoke test against a running server.
 *
 *   pnpm dev          # in one terminal
 *   pnpm verify:live  # in another
 *
 * The unit tests run the compiler in process against the checked in seed.
 * This runs the whole product over HTTP against whatever the server is
 * actually serving, which on a configured machine is Supabase. Every bug we
 * have shipped so far was one only a real database could find, so this exists
 * to find the next one before a demo does.
 *
 * Exits non zero on the first thing that is wrong. No test framework, no
 * config, nothing to install.
 */

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const get = async (path) => {
  const response = await fetch(BASE + path);
  return { status: response.status, body: await response.json() };
};

const post = async (path, body) => {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const compile = (goal, citizen = {}, district = "Ahmedabad") =>
  post("/api/journeys/compile", {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district },
    citizen,
  });

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

/** Type appropriate answer for a derived question, so we exercise the real path. */
const answerFor = (question) =>
  question.options?.length
    ? question.options[0].value
    : question.inputType === "NUMBER"
      ? 30
      : question.inputType === "BOOLEAN"
        ? true
        : "yes";

// ---------------------------------------------------------------- the graph

const districts = await get("/api/jurisdictions?parent=IN-GJ");
const districtNames = districts.body.jurisdictions?.filter((j) => j.level === "DISTRICT") ?? [];
check("districts come from rows, not an array in a component", districtNames.length >= 30, `${districtNames.length} districts`);

// -------------------------------------------------- every service, cold, over HTTP

// The list of goals to try comes off the seed bundles rather than a hardcoded
// array, so a service added tomorrow is verified tomorrow without editing this
// file. What gets compiled is still whatever the server is serving.
const { readdir, readFile } = await import("node:fs/promises");
const dir = new URL("../packages/core/src/data/graph/", import.meta.url);
const found = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
  const bundle = JSON.parse(await readFile(new URL(file, dir), "utf8"));
  for (const node of bundle.nodes ?? []) if (node.type === "SERVICE") found.push(node.id.replace(/^service:/, ""));
}
const services = [...new Set(found)];

let clean = 0;
const broken = [];
for (const goal of services) {
  const { status, body } = await compile(goal);
  if (status !== 200) {
    broken.push(`${goal}: HTTP ${status} ${body.error}`);
    continue;
  }
  const faults = [];
  if (!body.orderedSteps?.length) faults.push("no steps");
  if (body.orderedSteps.some((s) => !s.sources?.length)) faults.push("a step with no source");
  if (body.orderedSteps.some((s, i) => s.order !== i + 1)) faults.push("step order has a gap");
  if (body.blockers?.some((b) => !b.actor || !b.reason)) faults.push("a blocker with no actor or reason");
  if (body.outstandingQuestions?.some((q) => q.inputType === "SINGLE_SELECT" && !q.options?.length))
    faults.push("a single select with no options");
  if (!body.trace?.length) faults.push("no trace");
  if (faults.length) broken.push(`${goal}: ${faults.join(", ")}`);
  else clean++;
}
check(`every service compiles over HTTP`, broken.length === 0, `${clean}/${services.length} clean${broken.length ? "\n        " + broken.join("\n        ") : ""}`);

// ------------------------------------------------------------ personalisation

const cold = await compile("driving_licence");
const question = cold.body.outstandingQuestions[0];
const warm = await compile("driving_licence", { answers: { [question.field]: answerFor(question) } });
check(
  "answering a question changes the computation",
  warm.body.outstandingQuestions.length < cold.body.outstandingQuestions.length,
  `${cold.body.outstandingQuestions.length} questions, ${warm.body.outstandingQuestions.length} after answering ${question.field}`,
);

const document = cold.body.orderedSteps.flatMap((s) => s.documentsNeeded).find((d) => !d.producedByServiceId);
const held = await compile("driving_licence", { documents: [document.nodeId] });
check(
  "saying you hold a document shortens the list",
  held.body.summary.documentsToPrepareCount < cold.body.summary.documentsToPrepareCount,
  `${cold.body.summary.documentsToPrepareCount} to prepare, ${held.body.summary.documentsToPrepareCount} once you hold ${document.name}`,
);

check(
  "cross journey compile pulls prerequisites in under the stated goal",
  cold.body.orderedSteps.length > 1,
  `one goal, ${cold.body.orderedSteps.length} steps`,
);

const rajkot = await compile("driving_licence", {}, "Rajkot");
check(
  "jurisdiction is data, so another district just works",
  rajkot.status === 200 && rajkot.body.jurisdiction.chain.length >= 3,
  `${rajkot.body.jurisdiction.name} via ${rajkot.body.jurisdiction.chain?.join(" then ")}`,
);

// ------------------------------------------------------------------- honesty

check("no step renders without provenance", cold.body.orderedSteps.every((s) => s.sources.length), `${cold.body.orderedSteps.length} steps, all sourced`);

// IGNWPS is the honest worst case: four government pages, four different age
// ranges and amounts. The citizen has to be told they disagree, on the step
// itself, not somewhere in a debug payload.
const ignwps = await compile("ignwps");
const disputed = ignwps.body.orderedSteps
  .flatMap((s) => s.sources)
  .filter((s) => s.verificationStatus === "CONFLICTING");
check(
  "sources that disagree reach the citizen as disagreeing",
  disputed.length > 0,
  `${disputed.length} disputed citation(s) on the step the citizen actually reads`,
);

const officeSources = cold.body.orderedSteps.flatMap((s) => s.offices);
check(
  "every office we send someone to carries its address source",
  officeSources.every((o) => o.sources.length),
  `${officeSources.length} office(s) on the driving licence path`,
);

// ------------------------------------------------------------- refusing to guess

check("an unknown goal is a 404, not a near miss", (await compile("passport_renewal")).status === 404);
check(
  "an unknown jurisdiction is a 404",
  (await post("/api/journeys/compile", { goal: "driving_licence", jurisdiction: { country: "Atlantis" } })).status === 404,
);
check("a missing body is a 400, not a 500", (await post("/api/journeys/compile", {})).status === 400);
check("intent with no text is a 400", (await post("/api/intents/resolve", {})).status === 400);

// ------------------------------------------------------- plain language, any script

const intents = [
  ["aavak nu dakhlo", "service:income_certificate", "transliterated Gujarati"],
  ["મારે આવકનો દાખલો જોઈએ છે", "service:income_certificate", "a whole Gujarati sentence"],
  ["I want a driving licence", "service:driving_licence", "English"],
  ["vidhva sahay yojana", "service:widow_pension", "a scheme by its spoken name"],
];
for (const [text, expected, what] of intents) {
  const { body } = await post("/api/intents/resolve", { text });
  check(`intent: ${what}`, body.matches?.[0]?.goal === expected, `"${text}" -> ${body.matches?.[0]?.goal ?? "nothing"}`);
}

const nonsense = await post("/api/intents/resolve", { text: "I want to buy a bicycle" });
check(
  "nothing in the graph means no answer, not the nearest service",
  nonsense.body.matches.length === 0,
  `matches: ${nonsense.body.matches.map((m) => m.goal).join(", ") || "none"}`,
);

// -------------------------------------- the citizen who describes it instead of naming it

/**
 * Nobody in a queue says "widow pension". They say their husband died.
 *
 * These sentences share no useful word with any alias, so they exist to prove
 * the model pass is actually reachable. It was not: token overlap answered off
 * one shared word, upstream stopped at the first answer, and this whole pass
 * was dead code that every earlier run of this file reported as fine.
 *
 * Skipped rather than failed without a key, because the product is supposed to
 * degrade to token overlap on a machine that has none.
 */
const described = [
  ["my husband died and I have no income now", "service:widow_pension"],
  ["I am 70 and nobody supports me", "service:old_age_pension"],
  ["I left my job and want the money from my provident fund", "service:pf_final_settlement"],
];
for (const [text, expected] of described) {
  const { body } = await post("/api/intents/resolve", { text });
  const got = body.matches?.[0]?.goal;
  if (!got && !body.inferred) {
    console.log(`  --  described: "${text}" skipped, no model configured`);
    continue;
  }
  check(`described, not named: "${text}"`, got === expected && body.inferred === true, `-> ${got ?? "nothing"}`);
}

// ----------------------------------------------------------------------- report

for (const r of results) console.log(`${r.pass ? "  ok  " : "FAIL  "}${r.name}${r.detail ? `\n        ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${BASE}`);
process.exit(failed ? 1 : 0);
