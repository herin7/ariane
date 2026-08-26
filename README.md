# Ariane

**Government digitised its departments. Ariane builds the map between them.**

Ariane turns fragmented Gujarat public-service information into a source-backed
graph, and compiles that graph into citizen journeys. A model may propose
structure. The graph decides what is valid. Every surfaced government claim must
point to evidence.

> **LLM UNDERSTANDS. GRAPH DECIDES. SOURCE PROVES.**

---

## See it

```bash
pnpm install --frozen-lockfile
pnpm dev            # http://localhost:3000
```

Type "my PF withdrawal is stuck" or "I am 70 and nobody supports me". You get an
ordered path: what to prepare, what to do first, which portal or app, which
office, and where to escalate when it stalls. Every step has a source link and a
quote behind it, and every step that does not says "not verified yet" instead of
guessing.

Nothing above needs an API key, a database or a network connection. `pnpm shots`
renders the whole product to PNGs at every viewport width if you would rather
look than click.

## What Ariane is

A compiler. The input is an intent, a jurisdiction and whatever the citizen has
told us about themselves. The output is a personalised, dependency-ordered,
source-backed journey through the real government system.

It is not a chatbot with a government-flavoured prompt, and it is not a directory
of links. The thing in the middle is a typed graph of 3,425 nodes and 4,653
edges, and a compiler that walks it.

## Why it exists

Indian government services are digitised as *portals*. Citizens do not experience
them as portals. They experience them as journeys across many portals, documents,
offices and approvals, where the answer to "what do I do next" lives in six
places and the answer to "why is this stuck" lives in none.

Today the citizen is the workflow engine. They hold the dependency graph in their
head, discover prerequisites by being turned away at a counter, and find out that
a document expired from the person refusing it. Ariane moves that job into
software, without ever inventing a requirement to fill a gap.

## How it works

```
government pages, PDFs, portals
              |
              |  discover, fetch once, cache
              v
        extracted facts  ---- every fact's quote must appear verbatim
              |               in the page, or the fact is dropped
              |  compile
              v
   +---------------------+          +--------------------------+
   |  <graph>/research/* |          |       <graph>/*.json     |
   |  the evidence layer | <------> |       the graph layer    |
   +---------------------+          +--------------------------+
        the quote                        the node and the edge
              \                          /
               \   pnpm quotes:audit    /   every citation in the graph
                \  ties the two        /    must match a quote in the
                 v                    v     research file beside it
                    typed graph, 16 journeys
                              |
   intent + jurisdiction + citizen context
                              |
                    journey compiler
                              |
              ordered, personalised, cited path
```

Three properties do the work:

**Extraction is checked, not trusted.** A model reads a page and proposes facts.
Each fact carries the sentence it came from, and that sentence must be a verbatim
substring of the fetched page after whitespace normalisation. A model that
paraphrases gets its fact dropped, not corrected. Fabrication is structurally
impossible rather than discouraged.

**The graph decides, not the model.** Intent resolution is the only place a model
touches a request, and all it may do is name a service that already exists. It
cannot invent a requirement, a fee, an office or an order. Everything downstream
is a graph walk and a condition evaluator.

**Nothing ships uncited.** Every node and every edge carries at least one source.
That is a validator error in `pnpm graph:validate` and a check constraint in
Postgres, so it is not a convention anyone can quietly drop.

## Architecture

```
apps/
  web/        Next.js citizen product, API, admin graph explorer
  mobile/     Expo app on the same four endpoints, no rule logic of its own
packages/
  core/       ontology, graph algorithms, condition evaluator, journey compiler
    src/data/         which graph a process is on. no scheme lives in code
    src/db/           the same rows in Postgres, and the mapping between
scripts/
  ingest/     the pipeline that reads government pages and writes those rows
docs/
  research/   research pointers: hostnames, department directories, naming
fixtures/
  demo/       one synthetic page and the layers derived from it, for tests
.graph/       the real graph, gitignored, from `pnpm data:sync`
```

The rows themselves are not in this repository. They are third-party government
content, they change without a deploy, and 7MB of them in a diff is not review.
Postgres holds them, `.graph/` is a maintainer's local copy, and `fixtures/demo`
is what a clone with no credentials runs on. Same directory layout at both
sizes: `<dir>/<journey>.json` for the bundle, `<dir>/research/<journey>.json`
for the evidence behind it.

No Neo4j, no Kafka, no Redis, no Elasticsearch, no orchestration framework, no
second graph database. Postgres, a JSON seed, and files. The ingestion layer adds
zero runtime dependencies.

`loadLiveGraph()` reads Supabase when it is configured and the checked-in seed
when it is not, and the compiler cannot tell the difference. Correcting a fee the
government changed is an edit, not a deploy.

## Scope

**Gujarat.** Central portals appear where a Gujarat journey depends on them, as
dependencies rather than as standalone builds. This is not an all-India product
and does not claim to be one.

Sixteen journeys: driving licence, income and caste and domicile certificates,
scholarships, PF withdrawal, pensions, birth and death registration, district
certificates, permits and licences, welfare schemes, property and land, ration
card, GST, PAN, MSME and Udyam, startup registration, and a standalone offices
layer.

## Measured

Every number below comes out of a command in this repository.

| | | |
|---|---|---|
| 16 | journeys | `pnpm coverage` |
| 553 | services | `pnpm graph:stats` |
| 3,425 | nodes, across 14 node types | `pnpm graph:stats` |
| 4,653 | edges, across 14 of 16 edge types | `pnpm graph:stats` |
| 1,161 | sources | `pnpm graph:stats` |
| 11,460 | citations, every one matched to its quote | `pnpm quotes:audit` |
| 568 | of those a person checked | `pnpm coverage` |
| 10,739 | of those a machine extracted and quote-checked | `pnpm coverage` |
| 444 | gaps recorded rather than filled in | `pnpm coverage --gaps` |
| 1,000 | tests | `pnpm test` |
| 21 | end-to-end HTTP checks against a running server | `pnpm verify:live` |

How deep the 553 services go, which is the number that matters more than the
count:

```
source                553  100%
escalation            553  100%
application channel   542   98%
eligibility           252   46%
required documents    247   45%
ordered actions       171   31%
physical office       132   24%
helpline              126   23%
produced output        49    9%
tracking               40    7%
```

**Five journeys, 28 services, were researched by a person** reading a government
page and typing what it said: driving licence, certificates, scholarships, PF,
pensions. These have real prerequisites, alternative document sets, eligibility
rules the compiler evaluates, questions derived from the graph, and conflicting
sources shown as conflicting.

**Eleven journeys, 525 services, were compiled by the pipeline** from cached
government pages. Every fact was quoted from a page and the quote checked against
that page before it was allowed in, and no human has read them. Each one says so
on the step, above the fee, before you believe anything under it.

## Trust model

- Every node and edge carries at least one source. Enforced by the validator and
  by a Postgres check constraint.
- Every citation carries the verbatim sentence it came from, and
  `pnpm quotes:audit` fails the build if that sentence is not in the research
  file for the same journey.
- Citations carry a verification status: `VERIFIED` when a person read it,
  `EXTRACTED` when a machine did and the quote matched, `CONFLICTING` when
  sources disagree. The UI renders the difference rather than flattening it.
- Sources that disagree are stored with all sides. Nothing picks a winner,
  nothing averages.
- Anything unverified renders as "not verified yet" rather than as a plausible
  guess. UNKNOWN is an acceptable answer. FABRICATED is not.

## Known limitations

- **Gujarat only.** Coverage outside it is incidental.
- **Many services are shallow.** 382 of 553 compile to a single step. The graph
  knows a source and an escalation route for all of them and much less than that
  for most of them, which is why `pnpm coverage` prints the depth table above
  instead of one headline number.
- **Tracking and produced output are thin**, at 7% and 9%. Government pages
  describe how to apply far more often than they describe how to check on it.
- **Scanned PDFs are not read.** There is no OCR step, so a requirement that
  exists only inside a scanned image is a recorded gap.
- **JavaScript-only portals are unreachable.** At least one state portal renders
  entirely client-side and yields nothing to fetch.
- **No machine-written eligibility rule is evaluated.** Turning "the beneficiary
  must be a woman" into a condition means inventing the field it tests, so those
  criteria are quoted and the citizen decides.
- **7 cited sources were never successfully fetched.** They are recorded as gaps,
  never as citations, and nothing quotes them.

## Local setup

Node 22 or later, and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm gates            # everything that has to be true before you push
pnpm dev              # http://localhost:3000
pnpm mobile           # Expo. scan the QR code, needs pnpm dev running too
```

Useful on their own:

```bash
pnpm test             # graph, compiler and fixture tests
pnpm graph:validate   # structural integrity. zero errors, zero warnings
pnpm quotes:audit     # every quote traces back to a page somebody read
pnpm journey:test     # compile a journey in the terminal, no browser
pnpm coverage         # what each journey knows, and what it admits it does not
pnpm coverage --gaps  # read the 444 gaps
pnpm verify:live      # 21 end-to-end checks against a running server
pnpm db:push          # push the seed to Postgres. needs credentials
```

No credentials are needed for any of that except the last. Copy `.env.example`
to `.env.local` when you want Supabase, Bedrock or Sarvam. Everything has a
deterministic fallback, so a missing key degrades one feature and never the path.

The phone finds the API on its own: Expo already knows the dev machine's address,
so there is no IP to type anywhere. Set `EXPO_PUBLIC_API_URL` when the API is not
the laptop that served the bundle.

## Demo fixtures

`fixtures/demo/` is one synthetic government page and the two layers Ariane
derives from it: the extracted facts with their quotes, and the graph bundle
those facts compiled into. It is small enough to read in a minute, and
`packages/core/src/__tests__/demo-fixtures.test.ts` walks it end to end as part
of `pnpm gates`, proving the whole chain without needing a single real page.

The service is invented and its host is `services.example.gov.invalid`, a
reserved name that can never resolve, so nothing in there can be mistaken for a
government fact.

## The corpus is not in this repository

Building the graph involves fetching and caching thousands of government page
bodies and PDFs. That content belongs to the bodies that published it, and
republishing it in full is not this project's to do. So what ships here is the
layer that is ours: the extracted facts, the verbatim quote behind each one, and
the URL and retrieval date it came from.

Everything a normal clone needs works without it. The checks that reconcile
citations against saved page bodies live under `pnpm gates:corpus` and read a
corpus you point at:

```bash
ARIANE_CORPUS_DIR=/path/to/corpus pnpm gates:corpus
```

Without one it says so and exits non-zero, rather than reporting that every page
is missing. See NOTICE.

## Contributing

Three rules: no government fact in TypeScript, every claim points at evidence,
and never commit raw pages, model caches or credentials. `pnpm gates` enforces
the first two and `.gitignore` the third.

## License

Ariane's source is [Apache-2.0](LICENSE).

Government pages, documents and data referenced or quoted here are **not**
relicensed by that. They remain the property of the bodies that published them
and are subject to the terms of the sites they came from. See [NOTICE](NOTICE).

Nothing here is an official government publication or legal advice. Requirements
change; confirm against the official source, which every screen links to for
exactly that reason.
