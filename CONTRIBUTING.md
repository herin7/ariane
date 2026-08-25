# Contributing to Ariane

## Setup

Node 22 or later, and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm gates          # everything that has to be true before you push
pnpm dev            # the web app on http://localhost:3000
pnpm mobile         # the Expo app
```

No credentials are needed for any of that. The graph is seeded from JSON checked
into `packages/core/src/data/graph/`, so the tests, the CLIs and the web app all
work on a laptop with no network. `.env.example` lists what each optional key
turns on; copy it to `.env.local` if you want the model or the crawler.

## The rules that matter

**No government fact lives in TypeScript.** Services, documents, offices, fees,
eligibility rules and the quotes behind them are rows. A requirement that needs a
code change and a deploy to correct is a requirement that stays wrong. Code holds
the compiler and the rule evaluator, nothing else.

**Every government claim points at evidence.** A `SourceRef` carries the verbatim
sentence the claim came from, and `pnpm quotes:audit` fails the build if that
sentence is not in the research file for the same journey. Substring match after
whitespace and markdown normalisation, no fuzzy matching: a quote trimmed
differently passes, a paraphrase does not. That is the line, and it is the point.

**UNKNOWN is an acceptable answer. FABRICATED is not.** If a page does not say
what the fee is, the fee is absent and the journey says so. Two sources that
disagree are stored as `CONFLICTING` with both sides kept. Never invent an
office address, a phone number, a processing time or an eligibility rule, and
never silently pick a winner between sources.

**Never commit:**

- raw scraped or crawled page bodies, PDFs, or extracted PDF text
- model response caches, rerank caches, embedding or enrich caches
- API keys, tokens, connection strings, or anything else from `.env`
- machine-specific paths, personal email addresses or phone numbers
- planning notes, build logs, scratch files or agent transcripts

`.gitignore` covers the known shapes of all of these. It is not a substitute for
looking at `git status` before you commit.

**Tests use fixtures, not the corpus.** `fixtures/demo/` has a synthetic page and
the layers derived from it, and it is what a new test of the pipeline should
build on. If a test needs thousands of real pages to pass, it belongs under
`pnpm gates:corpus`, not `pnpm gates`.

## Gates

`pnpm gates` is the contract, and it has to pass on a fresh clone with no corpus
and no credentials:

| | |
|---|---|
| `pnpm typecheck` | strict, `noUncheckedIndexedAccess` on |
| `pnpm test` | vitest, no network, no model calls |
| `pnpm graph:validate` | the graph's own structural rules |
| `pnpm quotes:audit` | every citation traces to a read page |
| `pnpm coverage --check` | per-journey coverage has not silently dropped |
| `pnpm bundles:build --check` | the generated bundle manifest is not stale |
| `pnpm domains:build --check` | the generated domain tables are not stale |
| `--selftest` on each ingestion script | the pipeline's own unit checks |

`pnpm gates:corpus` is the internal one. It reconciles every cited URL against a
saved page body and needs a corpus:

```bash
ARIANE_CORPUS_DIR=/path/to/corpus pnpm gates:corpus
```

Without one it says so and exits non-zero rather than reporting that every page
is missing.

## Style

Match what is already there. TypeScript strict, no `any` at a seam, no new
runtime dependency for something a few lines of stdlib does.

Comments explain why, not what. A comment that says what the next line does is
noise; a comment that says which bug the guard on the next line exists to stop
is the most valuable thing in the file. Keep the ones about invariants,
provenance rules, trade-offs and non-obvious behaviour.

Commits are small and describe the change, not the process.

## Scope

Ariane is Gujarat-first. Central portals appear where a Gujarat journey depends
on them, not as standalone builds. Breadth without evidence is not the goal.
