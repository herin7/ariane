/**
 * What the product answers, captured over HTTP, so before and after are
 * comparable by `diff`.
 *
 *   pnpm --filter @ariane/web start               # in one terminal
 *   node scripts/ux-parity.mjs /tmp/before.json   # in another
 *   ...change something, restart the server...
 *   node scripts/ux-parity.mjs /tmp/after.json
 *   diff /tmp/before.json /tmp/after.json
 *
 * `pnpm graph:snapshot` fingerprints the compiler against a local graph. This
 * asks the running server, which on a configured machine is Supabase, and
 * records the whole compiled journey rather than a summary line: steps,
 * documents, blockers, questions, offices with their coordinates, helplines,
 * digital channels, sources. A reordered step list, a dropped phone number or
 * a citation that stopped resolving all show up as a diff, which is the point.
 *
 * Not a gate. `pnpm verify:live` is the gate and it asserts. This only records,
 * because "did anything change" is a different question from "is anything
 * wrong", and a data-plane refactor has to answer the first one.
 */

import { writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GRAPH } from "./ingest/lib.mjs";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/ux-parity.mjs <output.json>");
  process.exit(1);
}

const get = async (path) => (await fetch(BASE + path)).json();
const post = async (path, body) =>
  (
    await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json();

/** Every service the graph knows, so a service that stops existing is a diff line. */
const dir = pathToFileURL(`${GRAPH}/`);
const goals = new Set();
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "jurisdictions.json")) {
  const bundle = JSON.parse(await readFile(new URL(file, dir), "utf8"));
  for (const node of bundle.nodes ?? []) if (node.type === "SERVICE") goals.add(node.id);
}

const { jurisdictions } = await get("/api/jurisdictions?parent=IN-GJ");
const districts = jurisdictions.map((j) => `${j.id}\t${j.name}\t${j.level}`).sort();

const chan = (c) => [c.nodeId, c.channelType, c.url ?? "", (c.phoneNumbers ?? []).join(","), c.via].join("|");

const record = {};
const sourceIds = new Set();
for (const goal of [...goals].sort()) {
  const j = await post("/api/journeys/compile", {
    goal,
    jurisdiction: { country: "India", state: "Gujarat", district: "Ahmedabad" },
  });
  if (j.error) {
    record[goal] = { error: j.error };
    continue;
  }
  for (const s of j.sources) sourceIds.add(s.sourceId);
  record[goal] = {
    goalName: j.goalName,
    jurisdiction: j.jurisdiction,
    summary: j.summary,
    steps: j.orderedSteps.map((s) => s.nodeId),
    documentsNeeded: j.documentsNeeded.map((d) => d.nodeId).sort(),
    documentsReady: j.documentsReady.map((d) => d.nodeId).sort(),
    prerequisites: [...j.prerequisiteServices].sort(),
    blockers: j.blockers.map((b) => `${b.nodeId ?? ""}|${b.reason ?? b.kind ?? ""}`).sort(),
    questions: j.outstandingQuestions.map((q) => q.field).sort(),
    // Offices, helplines and coordinates are the half of the product a data
    // plane refactor is most likely to drop quietly, so they are compared whole.
    offices: j.offices
      .map((o) =>
        [
          o.nodeId,
          o.name,
          o.address ?? "",
          (o.phoneNumbers ?? []).join(","),
          o.workingHours ?? "",
          // Published, then derived. `DerivedLocation` spells them out in full
          // and `lat`/`lng` silently read as undefined, which is a map pin
          // going missing in a file whose whole job is to notice that.
          o.latitude ?? "",
          o.longitude ?? "",
          o.location ? `${o.location.status}:${o.location.latitude},${o.location.longitude}` : "",
        ].join("|"),
      )
      .sort(),
    helplines: j.helplines.map(chan).sort(),
    digitalChannels: j.digitalChannels.map(chan).sort(),
    mobileApps: j.mobileApps.map(chan).sort(),
    escalationPaths: j.escalationPaths.map(chan).sort(),
    // The quote too, not just the id. A citation that keeps its id and swaps
    // the sentence underneath it is the exact failure this pass is guarding.
    sources: j.sources
      .map((s) => [s.sourceId, s.source?.url ?? "", s.source?.title ?? "", s.source?.sourceType ?? "", s.evidence ?? ""].join("|"))
      .sort(),
    warnings: j.warnings,
  };
}

/**
 * Citations as the citizen follows them. `/api/sources/[id]` is what the
 * provenance panel calls, and a source row that stops resolving is invisible
 * in a compile response but a dead link on screen.
 */
const sources = {};
for (const id of [...sourceIds].sort().filter((_, i) => i % 25 === 0)) {
  sources[id] = await get(`/api/sources/${encodeURIComponent(id)}`);
}

/**
 * Intent, restricted to phrases the alias pass answers on its own. Anything
 * vaguer reaches Sarvam or Bedrock, and a model in the loop makes this file
 * disagree with itself between two runs that changed nothing.
 */
const intents = {};
for (const text of [
  "passport",
  "aadhaar",
  "voter id",
  "aavak nu dakhlo",
  "income certificate",
  "ration card",
  "driving licence",
  "birth certificate",
]) {
  const r = await post("/api/intents/resolve", { text });
  intents[text] = (r.matches ?? []).map((m) => `${m.goal}|${m.confidence}|${m.supportStatus ?? ""}`);
}

writeFileSync(out, `${JSON.stringify({ districts, goals: [...goals].sort(), record, sources, intents }, null, 2)}\n`);
console.log(
  `${Object.keys(record).length} journeys, ${districts.length} jurisdictions, ${Object.keys(sources).length} sources, ${Object.keys(intents).length} phrases -> ${out}`,
);
