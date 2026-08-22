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
docs/
  GOAL.md         current definition of done
  BUILD_PLAN.md   day by day execution log
log.md            milestone log
```

## Getting started

```bash
pnpm install
pnpm test        # graph + compiler unit and integration tests
pnpm dev         # http://localhost:3000
```

## Status

Early. See `log.md` for what actually works right now, and `docs/GOAL.md` for the
definition of done we are shipping against.
