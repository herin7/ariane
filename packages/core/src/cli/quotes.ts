import { localGraphProvider } from "../data/providers";
import type { SourceRef } from "../types";

/**
 * The anti hallucination gate.
 *
 * A journey's rows are only trustworthy if every quote in them was actually
 * read off a government page. The research file beside each bundle is the
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
 * Limitation: substring match after whitespace normalisation, no fuzzy matching.
 * A quote trimmed differently from the research file still passes, a
 * paraphrase does not, and that is the line worth drawing.
 */

/**
 * Read off the directory, not typed here. This list used to be its own copy of
 * the journey names, so a bundle added to the graph and forgotten here was a
 * bundle whose quotes nobody ever checked, and the audit still printed a
 * cheerful green pass.
 */
const graph = localGraphProvider();
const ALL = graph.journeys();

/**
 * Every source row in the graph, not just the bundle being audited.
 *
 * `pushToSupabase` writes one row per URL, so a page cited by two journeys is
 * stored under whichever one declared it first and comes back in that bundle
 * alone. `loadGraphFrom` flattens sources across bundles before anything reads
 * them, so the citation still resolves for a citizen — but checking it against
 * one bundle reads that round trip as 1121 unsourced claims, and a gate that
 * cries wolf after `pnpm data:sync` is a gate people learn to skip.
 *
 * Whether a citation resolves to a real page is a graph question and is asked
 * here. Whether its quote was read off that page is this journey's question and
 * is still asked below, per bundle, against that bundle's research file.
 */
const declared = new Set(graph.bundles().flatMap((b) => b.sources).map((s) => s.id));

/**
 * Markdown syntax is not part of what the page said.
 *
 * Research evidence is captured off markdown, so it arrives carrying `**` and
 * `\.` and `[label](url)`. A graph quote is written the way a citizen reads it.
 * Comparing those two raw made the audit reject quotes that were verbatim
 * correct, which trains everyone to work around the gate instead of trusting
 * it. Both sides get stripped, so a paraphrase still has different letters and
 * still fails.
 *
 * Character for character the same rule as
 * `scripts/ingest/services-extract.mjs`, which asserts the two agree.
 */
const norm = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([-.*_[\]()#+!`>~])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function auditOne(name: string): number {
  const journey = graph.bundle(name);
  if (!journey.nodes.length) {
    console.log(`${name}: not seeded yet, skipped`);
    return 0;
  }

  // A bundle with citations and no research file behind it is a bundle nobody
  // can audit, which is the exact thing this gate exists to refuse. It used to
  // throw ENOENT here, which reads as a broken checkout rather than as the
  // finding it is.
  const research = graph.research(name);
  if (!research) {
    console.log(`${name}: ${journey.nodes.length} node(s), 1 problem(s)`);
    console.log(`  FAIL no research file, so not one quote in this bundle can be traced to a page anybody read`);
    return 1;
  }

  const quotes = new Set<string>();
  for (const fact of research.facts ?? []) if (fact.evidence) quotes.add(norm(fact.evidence));
  for (const source of research.sources ?? []) if (source.title) quotes.add(norm(source.title));
  const urls = new Set<string>((research.sources ?? []).map((s) => norm(s.url ?? "")));

  const refs: { where: string; ref: SourceRef }[] = [];
  const collect = (where: string, list?: SourceRef[]) => {
    for (const ref of list ?? []) refs.push({ where, ref });
  };
  for (const n of journey.nodes) collect(`node ${n.id}`, n.sources);
  for (const e of journey.edges) collect(`edge ${e.id}`, e.sources);
  for (const g of journey.requirementGroups) collect(`group ${g.id}`, g.sources);

  const problems: string[] = [];

  for (const { where, ref } of refs) {
    if (!declared.has(ref.sourceId)) problems.push(`${where} cites ${ref.sourceId}, which no bundle declares`);
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
