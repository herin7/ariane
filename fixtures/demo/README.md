# Demo fixtures

One synthetic government page and the two layers Ariane derives from it. Small
enough to read in a minute, complete enough to exercise the whole chain:

```
source/tree-felling-permit.md   the page body, as the fetcher would have saved it
research/demo.json              what was extracted from it, with the quote behind each fact
demo.json                       the graph bundle those facts compiled into
escalation.json                 the `*` edge templates, stamped onto every service at load
research/escalation.json        the quote behind those templates
jurisdictions.json              the places the bundle's nodes live in
```

Same layout the real graph uses, at 1/500th the size: `<dir>/<journey>.json` for
a bundle, `<dir>/research/<journey>.json` for the evidence behind it,
`jurisdictions.json` for the places. That is not a coincidence and it is not
decoration. `packages/core/src/data/providers.ts` reads this directory and
`.graph/` with the same function, so the code a public clone exercises is the
code production runs.

`packages/core/src/__tests__/demo-fixtures.test.ts` walks it end to end and runs
as part of `pnpm gates`:

1. every fact's `evidence` is a verbatim substring of the page body
2. every graph citation matches a fact in `research/demo.json`, using the same
   comparison `pnpm quotes:audit` applies to the real bundles
3. the bundle passes `validateGraph` with no errors
4. it compiles into a journey whose steps and documents each carry a source

The service is invented. The host is `services.example.gov.invalid`, which is a
reserved name that can never resolve, so nothing here can be mistaken for a
government fact or followed to a real page.

This is what `pnpm gates` runs on, and it is deliberately far too small to be
mistaken for the real thing. Nine test files that assert Gujarat facts skip
themselves here and say so. A maintainer runs `pnpm data:sync` to fetch the real
graph into `.graph/`, and `pnpm gates:integration` then refuses to start without
it.

Neither the real graph nor the corpus behind it, thousands of fetched pages and
PDFs, is in this repository. See NOTICE for why, and `ARIANE_CORPUS_DIR` in
`.env.example` for how to point `pnpm gates:corpus` at a corpus if you have one.
