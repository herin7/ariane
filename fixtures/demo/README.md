# Demo fixtures

One synthetic government page and the two layers Ariane derives from it. Small
enough to read in a minute, complete enough to exercise the whole chain:

```
source/tree-felling-permit.md   the page body, as the fetcher would have saved it
research.json                   what was extracted from it, with the quote behind each fact
graph.json                      the graph bundle those facts compiled into
jurisdictions.json              the places the bundle's nodes live in
```

`packages/core/src/__tests__/demo-fixtures.test.ts` walks it end to end and runs
as part of `pnpm gates`:

1. every fact's `evidence` is a verbatim substring of the page body
2. every graph citation matches a fact in `research.json`, using the same
   comparison `pnpm quotes:audit` applies to the real bundles
3. the bundle passes `validateGraph` with no errors
4. it compiles into a journey whose steps and documents each carry a source

The service is invented. The host is `services.example.gov.invalid`, which is a
reserved name that can never resolve, so nothing here can be mistaken for a
government fact or followed to a real page.

The real corpus, thousands of fetched pages and PDFs, is not in this repository.
See NOTICE for why, and `ARIANE_CORPUS_DIR` in `.env.example` for how to point
`pnpm gates:corpus` at one if you have it.
