# ariane

**Government digitised its departments. We built the map between them.**

Ariane is a *government journey compiler*. A citizen describes what they need in
plain language ("I want a driving licence", "my PF withdrawal is stuck") and gets
back a personalised, dependency-aware, source-backed path through the actual
government system: which documents to prepare, which service to do first, which
official portal or app to use, which office to physically visit, and where to
escalate when it stalls.

Built for the **Build What Moves India** hackathon. Proving ground: **Gujarat**.

---

## The idea

Indian government services are digitised as *portals*. Citizens do not experience
them as portals, they experience them as journeys across many portals, documents,
offices and approvals. Today the citizen is the workflow engine. Ariane replaces
that with software.

```
intent + citizen context + jurisdiction
                 |
        journey compiler (graph)
                 |
   ordered, personalised, source-backed path
```

The core rule the whole system is built around:

> **The LLM understands. The graph decides.**

An LLM maps free text to a canonical goal and explains jargon in simple language.
It never invents a government requirement. Every requirement, dependency, portal,
office and escalation route comes from a graph of verified facts, each carrying
the official source URL and the evidence text it was taken from.

## Repo layout

```
apps/
  web/        Next.js citizen product + API + admin graph explorer
  mobile/     Expo app, same four endpoints, no rule logic of its own
packages/
  core/       ontology, graph algorithms, condition evaluator, journey compiler
  core/src/data/graph/  the government facts, as rows. no scheme is in code
  core/src/db/          the same rows in Postgres, and the mapping between
scripts/
  ingest/     the pipeline that reads government pages and writes those rows
docs/
  research/   the extracted source material every graph fact was read off
.ingest/      the page cache, the extracted facts, and what we refused to write
```

## Getting started

```bash
pnpm install
pnpm test             # graph + compiler unit and integration tests
pnpm graph:validate   # source integrity. must be zero errors, zero warnings
pnpm quotes:audit     # every quote traces back to a page somebody actually read
pnpm journey:test     # compile a journey in the terminal, no browser needed
pnpm dev              # http://localhost:3000
pnpm mobile           # Expo. scan the QR code, needs pnpm dev running too
pnpm coverage         # what each journey knows, and what it admits it does not
pnpm db:push          # push the seed to Supabase. needs credentials
pnpm verify:live      # 21 end to end checks against a running server
```

The pipeline that produced most of the graph runs offline too, because every page
it read is cached in `.ingest/` and every extraction is keyed on the page content
plus the prompt. Re-running it makes zero network calls and zero model calls
until something actually changes:

```bash
pnpm services:compile   # cached facts -> graph bundles + evidence files
pnpm fetch:ledger --check   # every citation traces to a page in the cache
```

The phone finds the API on its own: Expo already knows the dev machine's address
on the network, so there is no IP to type in anywhere. Set `EXPO_PUBLIC_API_URL`
when the API is not the laptop that served the bundle.

No credentials are needed for any of the above except the last one. Copy
`.env.example` to `.env.local` when you want Supabase, Bedrock, Sarvam or voice.
Everything has a deterministic fallback, so a missing key degrades one feature
and never the path.

## Where the government facts live

Not in code. Every scheme, document, fee, office, eligibility rule and the
verbatim quote behind it is a row. The rows are checked in as JSON under
`packages/core/src/data/graph` and mirrored into Postgres by `pnpm db:push`.

`loadLiveGraph()` reads Supabase when it is configured and the checked in seed
when it is not, and the compiler cannot tell the difference. So correcting a fee
the government changed is an edit, not a deploy, and the app still runs on a
laptop with no network.

The rules that hold whichever side it is loaded from:

- Every node and every edge carries at least one source. It is a check
  constraint in Postgres and a validator error in `graph:validate`.
- Sources that disagree are stored as `CONFLICTING` with all sides and shown to
  the citizen that way. Nothing picks a winner, nothing averages.
- Anything unverified renders as "not verified yet" rather than a plausible
  guess.

## Status

**14 journeys, 217 services, 830 nodes, 886 edges.** Every one of them compiles
over HTTP, which `pnpm verify:live` checks one at a time rather than taking our
word for it.

They are not all worth the same and the product says so on the step.

**Five journeys, 28 services, were researched by a person** reading a government
page and typing what it said: driving licence, income / caste / domicile
certificates, scholarships, PF withdrawal, widow and old age pensions. These are
the deep ones. They have real prerequisites, alternative document sets,
eligibility rules the compiler actually evaluates, questions derived from the
graph, and conflicting sources shown as conflicting.

**Nine journeys, 189 services, were compiled by the pipeline** from cached
government pages: district certificates, permits and licences, welfare schemes,
property and land, ration card, GST, PAN, MSME and Udyam, startup. These are the
broad ones. Every fact on them was quoted from a page and the quote checked
against that page byte for byte before it was allowed in, and none of them has
been read by a human being. So each one arrives with that said out loud, above
the fee, before you believe anything under it.

568 citations a person checked, 2507 a machine did. `pnpm coverage` prints the
split per journey, `pnpm quotes:audit` is what stops either number from being a
claim, and `pnpm coverage --gaps` reads out the 74 things we went looking for and
could not find, written down at the moment we gave up on each one. `/admin/coverage`
shows the same 74 to anyone without a terminal.

Known gaps, recorded rather than papered over: 925 pdfs in the cache we have no
reader for, one state portal that renders entirely in javascript, and no
machine-written eligibility rule the compiler can evaluate, because turning "the
beneficiary must be a woman" into a condition means inventing the field it tests.
Those criteria are quoted instead, and the citizen decides.
