# Research drops

Raw, source-backed research output lands here as JSON, one file per journey:
`driving-licence.json`, `certificates.json`, `scholarship.json`, `pf.json`,
`pension.json`.

Each file is the honest middle layer between an official government page and
the graph:

```
official page -> RAW SOURCE -> extraction -> THIS FILE -> verified graph facts
```

Shape:

```jsonc
{
  "journey": "driving_licence",
  "researchedAt": "<ISO>",
  "sources": [
    { "id": "src_...", "url": "...", "title": "...", "domain": "...",
      "sourceType": "SERVICE_PAGE", "retrievedAt": "<ISO>", "scrapedOk": true }
  ],
  "facts": [
    { "claim": "...", "kind": "DEPENDENCY", "subject": "...", "object": "...",
      "sourceId": "src_...", "evidence": "<verbatim quote from the page>",
      "confidence": 0.95 }
  ],
  "notFound": ["what we looked for and could not verify officially"]
}
```

## The one rule

No verbatim `evidence` quote, no fact. Anything that cannot be quoted from an
official `.gov.in` / `.nic.in` page goes in `notFound` and renders in the
product as **Not verified yet**. We never fill a gap from general knowledge,
because a citizen acting on an invented requirement is worse off than a citizen
we told the truth to.
