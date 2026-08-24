/**
 * What the pipeline threw away, and why.
 *
 *   pnpm rejections:stats            everything, grouped by stage
 *   pnpm rejections:stats --reason EVIDENCE_NOT_VERBATIM   the rows themselves
 *   pnpm rejections:stats --stage compile
 *
 * Two ledgers, because the two stages lose things for different reasons and
 * keep the record in different places.
 *
 * Extraction's drops live inside the extraction cache files. They are not
 * recomputable without paying the model a second time, and the cache key
 * already pins the content, schema, prompt, gate and model, so the drops and
 * the facts can never end up describing different runs.
 *
 * Compile's drops live in `.ingest/rejections.jsonl`, rebuilt wholesale by
 * every compile and gitignored, because they *are* recomputable from committed
 * facts with zero model calls. `docs/research/rejections.json` is the small
 * committed aggregate, and it is what shows up in a diff.
 *
 * The number this exists to make un-ignorable: 19,622 facts on disk, 8,539
 * citations shipped. Everything in between used to be silence.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { at, readJsonl, REJECTION_REASONS, REJECTIONS } from "./lib.mjs";

/** Same directory `services-extract.mjs` writes, deliberately read only here. */
const EXTRACT = ".ingest/extract/";

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Every rejection on disk, from both ledgers, in one shape.
 *
 * `unaudited` counts the cache entries written before the drops were kept.
 * They hold a number where the rows should be, and reporting them as zero
 * rejections would be a lie in exactly the direction that flatters us.
 */
export function collect({ extractDir, rejectionRows }) {
  const rows = [...rejectionRows];
  let unaudited = 0;
  let unauditedDrops = 0;
  for (const file of extractDir) {
    const r = file.json;
    if (Array.isArray(r?.dropped)) {
      for (const d of r.dropped) rows.push({ stage: "extract", reason: d.reason, url: r.url ?? file.name, kind: d.kind, claim: d.claim, evidence: d.evidence, note: d.note });
    } else if (Number(r?.dropped) > 0) {
      unaudited++;
      unauditedDrops += Number(r.dropped);
    }
  }
  return { rows, unaudited, unauditedDrops };
}

/** stage|reason -> count, biggest first. */
export function tally(rows) {
  const by = new Map();
  for (const row of rows) {
    const key = `${row.stage}|${row.reason}`;
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([key, count]) => {
      const [stage, reason] = key.split("|");
      return { stage, reason, count };
    })
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// --------------------------------------------------------------------- tests

{
  if (flag("selftest")) {
    const { default: assert } = await import("node:assert/strict");

    const got = collect({
      extractDir: [
        { name: "a", json: { url: "https://a.gov.in/1", dropped: [{ reason: "EVIDENCE_NOT_VERBATIM", claim: "x" }, { reason: "DUPLICATE", claim: "y" }] } },
        // The legacy shape. Counted as unauditable, never as clean.
        { name: "b", json: { url: "https://b.gov.in/1", dropped: 7 } },
        { name: "c", json: { url: "https://c.gov.in/1", dropped: 0 } },
      ],
      rejectionRows: [{ stage: "compile", reason: "NO_EXPLICIT_ORDER" }, { stage: "compile", reason: "NO_EXPLICIT_ORDER" }, { stage: "compile", reason: "NOT_A_DOCUMENT" }],
    });
    assert.equal(got.rows.length, 5, "both ledgers, one list");
    assert.equal(got.unaudited, 1, "a page read before the drops were kept is not a page that dropped nothing");
    assert.equal(got.unauditedDrops, 7);
    assert.equal(got.rows.filter((r) => r.stage === "extract").length, 2);

    const counted = tally(got.rows);
    assert.deepEqual(counted[0], { stage: "compile", reason: "NO_EXPLICIT_ORDER", count: 2 }, "biggest loss first, because that is the one worth fixing");
    assert.equal(counted.length, 4);

    // Every reason we can print has to be one the table explains, or the report
    // is a list of shouty strings.
    for (const { reason } of counted) assert.ok(Object.hasOwn(REJECTION_REASONS, reason), `${reason} is not in REJECTION_REASONS`);

    console.log("rejections-stats: ok");
    process.exit(0);
  }

  // ------------------------------------------------------------------- report

  const dir = existsSync(at(EXTRACT)) ? readdirSync(at(EXTRACT)).filter((f) => f.endsWith(".json")) : [];
  const extractDir = dir.map((name) => {
    try {
      return { name, json: JSON.parse(readFileSync(at(EXTRACT + name), "utf8")) };
    } catch {
      return { name, json: null };
    }
  });

  const { rows, unaudited, unauditedDrops } = collect({ extractDir, rejectionRows: readJsonl(REJECTIONS) });

  const wantStage = value("stage");
  const wantReason = value("reason");
  const shown = rows.filter((r) => (!wantStage || r.stage === wantStage) && (!wantReason || r.reason === wantReason));

  if (wantReason) {
    console.log(`${shown.length} row(s) rejected as ${wantReason}: ${REJECTION_REASONS[wantReason] ?? "an unknown reason"}\n`);
    for (const r of shown.slice(0, Number(value("limit", 40)))) {
      console.log(`  ${r.url ?? "-"}`);
      if (r.claim) console.log(`    claim: ${r.claim}`);
      if (r.evidence) console.log(`    quote: ${r.evidence}`);
      if (r.note) console.log(`    note:  ${r.note}`);
    }
    process.exit(0);
  }

  const counted = tally(shown);
  const width = Math.max(0, ...counted.map((c) => c.reason.length));
  let stage = null;
  console.log(`${shown.length} candidate(s) refused across ${new Set(shown.map((r) => r.stage)).size} stage(s)\n`);
  for (const c of [...counted].sort((a, b) => a.stage.localeCompare(b.stage) || b.count - a.count)) {
    if (c.stage !== stage) {
      stage = c.stage;
      console.log(`${stage}`);
    }
    console.log(`  ${String(c.count).padStart(6)}  ${c.reason.padEnd(width)}  ${REJECTION_REASONS[c.reason] ?? ""}`);
  }

  // A reason with no rows is not a bug. It is a hole we have named and not yet
  // filled, and printing it is how it stays visible.
  const never = Object.keys(REJECTION_REASONS).filter((r) => !counted.some((c) => c.reason === r));
  if (never.length) console.log(`\n${never.length} reason(s) declared and never used: ${never.join(", ")}`);

  if (unaudited) {
    console.log(`\n${unaudited} cached extraction(s) predate keeping the drops, so their ${unauditedDrops} refusals are a number and nothing else.`);
    console.log(`They will become auditable the next time the gate or prompt version changes, and paying for that alone is not worth ${unauditedDrops} rows.`);
  }
  if (!rows.some((r) => r.stage === "compile")) console.log(`\nNo compile rejections on disk. Run: pnpm services:compile --dry`);
}
