import { readFileSync } from "node:fs";
import type { GraphBundle } from "../data/index";
import type { SourceRef } from "../types";

/**
 * The anti hallucination gate.
 *
 * A journey's rows are only trustworthy if every quote in them was actually
 * read off a government page. The research files under docs/research are the
 * record of what was read. This walks every SourceRef in a journey bundle and
 * checks its evidence string appears in the matching research file, and that
 * every source URL it cites was one the researcher actually fetched.
 *
 * It cannot prove a claim is true. It can prove nobody typed a quote from
 * memory, which is the failure mode that matters here.
 *
 *   pnpm quotes:audit                 every journey
 *   pnpm quotes:audit certificates    just one
 *
 * ponytail: substring match after whitespace normalisation, no fuzzy matching.
 * A quote trimmed differently from the research file still passes, a
 * paraphrase does not, and that is the line worth drawing.
 */

const ALL = ["driving-licence", "certificates", "scholarship", "pf", "pension"];

const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function auditOne(name: string): number {
  const journey: GraphBundle = read(new URL(`../data/graph/${name}.json`, import.meta.url));
  if (!journey.nodes.length) {
    console.log(`${name}: not seeded yet, skipped`);
    return 0;
  }

  const research = read(new URL(`../../../../docs/research/${name}.json`, import.meta.url));

  const quotes = new Set<string>();
  for (const fact of research.facts) if (fact.evidence) quotes.add(norm(fact.evidence));
  for (const source of research.sources) if (source.title) quotes.add(norm(source.title));
  const urls = new Set<string>(research.sources.map((s: { url: string }) => norm(s.url)));

  const refs: { where: string; ref: SourceRef }[] = [];
  const collect = (where: string, list?: SourceRef[]) => {
    for (const ref of list ?? []) refs.push({ where, ref });
  };
  for (const n of journey.nodes) collect(`node ${n.id}`, n.sources);
  for (const e of journey.edges) collect(`edge ${e.id}`, e.sources);
  for (const g of journey.requirementGroups) collect(`group ${g.id}`, g.sources);

  const declared = new Set(journey.sources.map((s) => s.id));
  const problems: string[] = [];

  for (const { where, ref } of refs) {
    if (!declared.has(ref.sourceId)) problems.push(`${where} cites ${ref.sourceId}, which this journey does not declare`);
    if (!ref.evidence) {
      problems.push(`${where} cites ${ref.sourceId} with no quote at all`);
      continue;
    }
    const q = norm(ref.evidence);
    if (![...quotes].some((k) => k.includes(q) || q.includes(k))) {
      problems.push(`${where} quotes something no researcher recorded: "${ref.evidence.slice(0, 100)}"`);
    }
  }

  for (const source of journey.sources) {
    if (!urls.has(norm(source.url))) problems.push(`source ${source.id} points at a URL no researcher fetched: ${source.url}`);
  }

  console.log(`${name}: ${refs.length} citation(s), ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  FAIL ${p}`);
  return problems.length;
}

const wanted = process.argv.slice(2);
let failures = 0;
for (const name of wanted.length ? wanted : ALL) failures += auditOne(name);

console.log(failures ? `\n${failures} unsourced claim(s). Fix the file or the research, not the check.` : "\nEvery quote traces back to a page somebody actually read.");
process.exit(failures ? 1 : 0);
