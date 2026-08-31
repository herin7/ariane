/**
 * The other half of the anti hallucination gate.
 *
 *   node scripts/research-verbatim.mjs                  every journey
 *   node scripts/research-verbatim.mjs central-services  just one
 *   node scripts/research-verbatim.mjs --selftest
 *
 * `pnpm quotes:audit` proves every quote in a bundle was recorded by a
 * researcher. Nothing proved the researcher's own quote was on the page. That
 * was fine while every research file came out of `services:extract`, which
 * drops any fact it cannot find verbatim - and stopped being fine the moment a
 * hand written bundle got hand written research to go with it.
 *
 * So: each fact's evidence must appear in the cached page its source names, and
 * that page must still hash to the `contentHash` the source recorded. Same
 * normalisation as `quotes:audit`, so a quote that passes here passes there.
 *
 * Only checks what it can see. The corpus is gitignored and a clone has none of
 * it, so a source with no cache file on disk is skipped and counted, not failed
 * - `pnpm fetch:ledger --check` is the gate that says a citation must have one.
 */

import { at, RESEARCH, sha256 } from "./ingest/lib.mjs";
import { readdirSync, readFileSync } from "node:fs";

/** Character for character the rule in `packages/core/src/cli/quotes.ts`. */
export const norm = (s) =>
  String(s ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([-.*_[\]()#+!`>~])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const args = process.argv.slice(2);

if (args.includes("--selftest")) {
  const { strict: assert } = await import("node:assert");
  const page = norm("Applicant will fill **PAN Change Request** Form  online\nand submit the form.");
  assert.ok(page.includes(norm("PAN Change Request Form online and submit the form.")), "line breaks and bold are not part of what the page said");
  assert.ok(!page.includes(norm("Applicant must fill the PAN Change Request Form")), "a paraphrase is still a paraphrase");
  assert.equal(norm("[Update Aadhaar](https://x)"), "update aadhaar", "a markdown link reads as its label");
  console.log("research-verbatim selftest ok");
  process.exit(0);
}

const wanted = args.filter((a) => !a.startsWith("--"));
const files = readdirSync(RESEARCH).filter((f) => f.endsWith(".json"));
const journeys = wanted.length ? wanted.map((n) => `${n}.json`) : files;

let checked = 0;
let skipped = 0;
const problems = [];

for (const file of journeys) {
  let research;
  try {
    research = JSON.parse(readFileSync(`${RESEARCH}/${file}`, "utf8"));
  } catch {
    problems.push(`${file}: no research file to check`);
    continue;
  }

  /** sourceId -> the normalised page, read once however many facts cite it. */
  const pages = new Map();
  for (const source of research.sources ?? []) {
    if (!source.cacheFile) {
      skipped++;
      continue;
    }
    let body;
    try {
      body = readFileSync(at(source.cacheFile), "utf8");
    } catch {
      skipped++;
      continue;
    }
    // A quote is only checkable against the bytes the source pinned. A page
    // refetched since is a different page, and matching against it would quietly
    // re-verify a fact nobody read on the version we cite.
    if (source.contentHash && sha256(body) !== source.contentHash) {
      problems.push(`${file}: ${source.id} cached page no longer hashes to the recorded contentHash`);
      continue;
    }
    pages.set(source.id, norm(body));
  }

  for (const fact of research.facts ?? []) {
    const page = pages.get(fact.sourceId);
    if (page === undefined) continue;
    checked++;
    if (!page.includes(norm(fact.evidence))) {
      problems.push(`${file}: ${fact.sourceId} was never on that page: "${String(fact.evidence).slice(0, 90)}"`);
    }
  }
}

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(`${checked} quote(s) checked against the page they came off, ${skipped} source(s) with no local page, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
