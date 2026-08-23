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
packages/
  core/       ontology, graph algorithms, condition evaluator, journey compiler
  core/src/data/graph/  the government facts, as rows. no scheme is in code
  core/src/db/          the same rows in Postgres, and the mapping between
docs/
  research/   the extracted source material every graph fact was read off
```

## Getting started

```bash
pnpm install
pnpm test             # graph + compiler unit and integration tests
pnpm graph:validate   # source integrity. must be zero errors, zero warnings
pnpm quotes:audit     # every quote traces back to a page somebody actually read
pnpm journey:test     # compile a journey in the terminal, no browser needed
pnpm dev              # http://localhost:3000
pnpm db:push          # push the seed to Supabase. needs credentials
```

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

Early, and honest about it. Five journeys are seeded and tested: driving licence,
income / caste / domicile certificates, scholarships, PF withdrawal, and widow
and old age pensions. `pnpm test` and `pnpm quotes:audit` are the two commands
that tell you what actually holds right now.
