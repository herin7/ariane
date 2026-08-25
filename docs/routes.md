# Backend routes

Every HTTP endpoint `apps/web` serves, written for whoever is building the UI.

Base URL is the app itself — `http://localhost:3000` in development. Everything
is JSON in and JSON out. Nothing is versioned yet; if a shape changes, it changes
here in the same commit.

Two families:

- **Graph routes** (`/api/intents`, `/api/journeys`, `/api/jurisdictions`,
  `/api/sources`, `/api/graph`) — public, stateless, no auth. These are what the
  website is built on today.
- **Voice routes** (`/api/voice/*`) — session-bound, bearer token on every call,
  `503` on a deployment without voice credentials. New, on
  `feat/ariane-voice-agent`.

An error body is always `{ "error": string }` except under `/api/voice/tool` and
the Vapi webhook, which return a `ToolResult` (below) so the model always has
something safe to say.

---

## Contents

| Method | Path | Auth |
| --- | --- | --- |
| POST | [`/api/intents/resolve`](#post-apiintentsresolve) | none |
| POST | [`/api/journeys/compile`](#post-apijourneyscompile) | none |
| GET | [`/api/jurisdictions`](#get-apijurisdictions) | none |
| GET | [`/api/sources/:id`](#get-apisourcesid) | none |
| GET | [`/api/graph/nodes/:id`](#get-apigraphnodesid) | none |
| POST | [`/api/voice/session`](#post-apivoicesession) | none (mints one) |
| DELETE | [`/api/voice/session`](#delete-apivoicesession) | bearer |
| POST | [`/api/voice/tool`](#post-apivoicetool) | bearer |
| GET | [`/api/voice/context`](#get-apivoicecontext) | bearer |
| POST | [`/api/voice/vapi/webhook`](#post-apivoicevapiwebhook) | HMAC signature |

---

# Graph routes

## POST `/api/intents/resolve`

Plain language to candidate services. Returns candidates rather than picking
one, because guessing wrong sends someone to the wrong office.

Three passes internally (token overlap, then a model read, then an inference)
and the response tells you which one answered.

**Request**

```json
{ "text": "mara papa gujri gaya" }
```

`text` is required and non-empty, otherwise `400`.

**Response `200`**

```json
{
  "query": "mara papa gujri gaya",
  "matches": [
    {
      "goal": "service:death_certificate",
      "name": "Death Certificate",
      "officialName": "Maran nu Praman Patra",
      "confidence": 0.82,
      "matched": ["death", "certificate"]
    }
  ],
  "understoodAs": "my father died",
  "detectedLanguage": "gu",
  "inferred": true
}
```

- `matches` is ordered best first and may be empty. **Empty means say so** — the
  UI must not offer a nearest guess.
- `confidence` is 0–1. Anything under `0.3` did not come from word overlap; a
  model read the sentence, so label it as a guess in the UI.
- `matched` lists the words that actually matched, so the citizen can correct us.
- `understoodAs` / `detectedLanguage` are present only when the input was not
  English. Show the translation so a citizen can tell us we misread them.
- `inferred: true` means nothing matched literally and the goal came from
  reading the situation ("my father died" → death certificate). Say so in the
  UI; it is the guessiest answer we give.

**Errors** — `400` `text is required`.

## POST `/api/journeys/compile`

The whole product in one endpoint. Post a goal, a jurisdiction and whatever the
citizen has told you; get back the path, the documents, and the questions still
outstanding. Post again with more answers and get a shorter, more certain path.

**Request** (`CompileRequest`)

```json
{
  "goal": "service:income_certificate",
  "jurisdiction": { "country": "IN", "state": "GJ", "district": "Ahmedabad" },
  "citizen": {
    "documents": ["document:aadhaar"],
    "answers": { "household_size": 5, "annual_income": 120000 }
  }
}
```

- `goal` takes either `service:income_certificate` or `income_certificate`.
- `jurisdiction.country` is required; `state`, `district`, `taluka` narrow it.
- `citizen` is optional. `documents` is the node ids they hold, `answers` is
  keyed by the `field` of questions we previously asked.

**Response `200`** (`CompiledJourney`, the full shape in
`packages/core/src/types.ts:554`)

```json
{
  "goal": "service:income_certificate",
  "goalName": "Income Certificate",
  "jurisdiction": { "resolvedId": "IN-GJ-AHMEDABAD", "chain": ["IN", "IN-GJ", "IN-GJ-AHMEDABAD"], "name": "Ahmedabad" },
  "summary": { "documentsReadyCount": 1, "documentsToPrepareCount": 2, "stepsRemaining": 3, "physicalVisits": 1, "digitalChannels": 2, "blockerCount": 0 },
  "orderedSteps": [{ "nodeId": "...", "title": "...", "state": "READY", "whatToDo": "...", "machineExtracted": false }],
  "documentsReady": [], "documentsNeeded": [],
  "outstandingQuestions": [{ "field": "household_size", "label": "How many people live in your household?", "inputType": "NUMBER", "options": [] }],
  "offices": [], "digitalChannels": [], "mobileApps": [], "helplines": [], "escalationPaths": [],
  "blockers": [], "prerequisiteServices": [], "nodeStates": {},
  "graph": { "nodes": [], "edges": [] },
  "sources": [], "trace": [], "warnings": []
}
```

Things worth knowing before you render it:

- **`outstandingQuestions` is the loop.** Each has a `field` — put the answer
  back under `citizen.answers[field]` and recompile.
- **`machineExtracted: true` on a step means no person has read the page behind
  it.** It has to be visible in the UI, not buried in a tooltip.
- `sources` is every citation inflated once, so you can link
  `sources[i].url` rather than fetching `/api/sources/:id` per claim.
- `warnings` should be empty. If it is not, the source data has a cycle in it;
  log it, do not hide it.
- `trace` is the compiler explaining itself. Useful in an admin view, noise in a
  citizen one.

**Errors** — `400` body was not JSON, or `goal`/`jurisdiction.country` missing.
`404` the goal or the jurisdiction is not in the graph (the message says which).

## GET `/api/jurisdictions`

The district list, out of the jurisdiction rows rather than an array in a
component.

**Query** — `?parent=IN-GJ` (default `IN-GJ`).

**Response `200`**

```json
{
  "parent": "IN-GJ",
  "jurisdictions": [{ "id": "IN-GJ-AHMEDABAD", "name": "Ahmedabad", "level": "DISTRICT" }]
}
```

Sorted by name. An unknown parent returns an empty array, not a `404`.

## GET `/api/sources/:id`

Where a claim came from, so anyone can go and check.

`:id` must be URL-encoded — source ids contain colons (`src:gujarat_rtps_01`).

**Response `200`**

```json
{
  "id": "src:gujarat_rtps_01",
  "url": "https://...",
  "title": "Income Certificate — Digital Gujarat",
  "domain": "digitalgujarat.gov.in",
  "sourceType": "SERVICE_PAGE",
  "jurisdictionId": "IN-GJ",
  "retrievedAt": "2026-01-14"
}
```

**Errors** — `404` `No source <id>`.

## GET `/api/graph/nodes/:id`

One node with its edges and its provenance already inflated. This is the admin
and debugging route; a citizen-facing screen wants `/api/journeys/compile`.

`:id` must be URL-encoded (`service%3Aincome_certificate`).

**Response `200`**

```json
{
  "node": { "id": "service:income_certificate", "type": "SERVICE", "name": "...", "jurisdictionId": "IN-GJ", "metadata": {}, "sources": [] },
  "sources": [{ "id": "src:...", "url": "...", "title": "..." }],
  "outgoing": [{ "id": "edge:...", "from": "...", "to": "...", "type": "REQUIRES" }],
  "incoming": [],
  "requirementGroups": []
}
```

**Errors** — `404` `No node <id>`.

---

# Voice routes

All four live behind a runtime that only starts when `VOICE_SESSION_SECRET` and
`VOICE_PHONE_HMAC_SECRET` are set. Without them every voice route returns:

```json
{ "error": "Voice is not configured on this deployment" }
```

with status **`503`** — the route exists, the deployment has not been given
keys. Probe it once on load and hide the microphone if it fails; do not treat it
as an outage.

### The session token

`POST /api/voice/session` returns a `token`. Every subsequent voice call carries
it as `Authorization: Bearer <token>` — never in a query string, those end up in
logs. The token is bound to one session id; presenting it against a different
session is `401`, not a mix-up.

### `ToolResult`

`/api/voice/tool` always returns one of these, and the HTTP status is a mirror of
the code rather than the source of truth:

```ts
{ ok: true,  data: unknown, grounding: SpeakableFact[] }
{ ok: false, code: RefusalCode, speak: string }
```

`speak` is always safe to display or say out loud. It never contains an internal
error, a credential or another citizen's data.

| `code` | HTTP | Means |
| --- | --- | --- |
| `NO_SESSION` | 401 | Token unknown, or bound to another session |
| `SESSION_EXPIRED` | 401 | Past the ten minute call or the token's expiry |
| `SESSION_ENDED` | 401 | Hung up already |
| `UNKNOWN_TOOL` | 403 | Not one of the eight tools |
| `TOOL_NOT_ALLOWED` | 403 | A real tool, not at this identity level |
| `IDENTITY_REQUIRED` | 403 | Needs VERIFIED and the caller is not |
| `GUARDRAIL` | 403 | Input tripped the injection filter |
| `INVALID_ARGUMENTS` | 400 | Failed the tool's schema, including extra keys |
| `PAYLOAD_TOO_LARGE` | 413 | Arguments over the per-call cap |
| `BUDGET_EXCEEDED` | 429 | Session tool ceiling, or downgraded for failures |
| `RATE_LIMITED` | 429 | Too many calls too fast |
| `NO_ACTIVE_JOURNEY` | 404 | Nothing open on this session yet |
| `NOT_FOUND` | 404 | No such service, step, or saved journey |
| `UPSTREAM_UNAVAILABLE` | 502 | The graph could not be loaded |
| `TIMEOUT` | 504 | A tool took too long |

`BUDGET_EXCEEDED` with `identityLevel` back at `ANONYMOUS` on the next `/context`
poll means the session was downgraded — four failed tool calls running. Surface
it; the caller is not imagining that things stopped working.

### `SpeakableFact`

```ts
{ claimId: string, text: string, sourceId?: string, machineExtracted?: boolean }
```

The closed set of government claims the model is allowed to state. If you render
the grounding beside the transcript, `sourceId` links to `/api/sources/:id`.
`sourceId` is absent only for facts about the caller's own session (their saved
preference, the service's own name).

## POST `/api/voice/session`

Opens a browser voice call and mints a **short-lived** OpenAI Realtime
credential. This is the only place an OpenAI credential is created and what
leaves here is scoped to one realtime session.

**Request** — body optional, `{}` is fine.

```json
{
  "jurisdiction": { "country": "IN", "state": "GJ", "district": "Ahmedabad" },
  "language": "gu"
}
```

`language` is one of `en` | `hi` | `gu`. The schema is strict: **any other key is
a `400`.** There is deliberately no `citizenId`, no `identityLevel`, no tool
list and no instruction override — the tool list is computed server-side from
the session's level and baked into the credential.

**Response `200`**

```json
{
  "sessionId": "9f1c…",
  "token": "kJ2…",
  "clientSecret": "ek_…",
  "model": "gpt-realtime",
  "credentialExpiresAt": 1780000060000,
  "expiresAt": 1780000600000,
  "identityLevel": "ANONYMOUS",
  "allowedTools": ["resolve_need", "start_journey", "answer_question", "get_current_journey", "explain_step"],
  "returning": false
}
```

- `clientSecret` goes to OpenAI, **never** to our own routes.
- `token` goes to our own routes, **never** to OpenAI.
- Two clocks on purpose: `credentialExpiresAt` is about a minute and only covers
  the WebRTC handshake; `expiresAt` is the ten minute call.
- `allowedTools` is what the model was given. A browser session is `ANONYMOUS`
  until somebody builds a web sign-in, so `save_preference`, `forget_my_data`
  and `resume_journey` are absent.
- `returning` is `true` for a recognised caller (telephony only today). When
  `false` the model has been told to say the consent line.

`packages/voice/src/client.ts` already does the whole dance — `new VoiceClient()`
then `.start()`. Use it rather than reimplementing the SDP exchange.

**Errors** — `400` body was not JSON or failed the schema. `429`
`BUDGET_EXCEEDED` / `RATE_LIMITED` with `{ error, code }` when a ceiling is hit.
`502` the credential could not be minted (the session is ended for you, so retry
from scratch). `503` voice not configured.

## DELETE `/api/voice/session`

Hang up. `?sessionId=…` plus the bearer token.

**Response `200`** — `{ "ended": true }`.

Always `200`. Hanging up twice on a flaky connection is not an error and there is
nothing left to leak. Call it on `beforeunload` too: a session left open holds a
concurrency slot for ten minutes.

## POST `/api/voice/tool`

The model proposed something; the server decides. The browser relay calls this
with whatever the model asked for and sends the result back down the data
channel.

**Request**

```json
{
  "sessionId": "9f1c…",
  "callId": "call_abc",
  "name": "start_journey",
  "arguments": { "serviceId": "service:income_certificate" }
}
```

`arguments` may be an object or the JSON string providers send. Strict schema:
extra top-level keys are `400`.

**The eight tools.** Nothing else exists; anything else is `UNKNOWN_TOOL`.

| Tool | Arguments | Needs | `data` on success |
| --- | --- | --- | --- |
| `resolve_need` | `{ utterance: string ≤400 }` | anonymous | `{ status: "CANDIDATES" \| "NOT_FOUND", candidates: [{ serviceId, name, because }], say? }` |
| `start_journey` | `{ serviceId: NodeId }` | anonymous | `VoiceJourney` |
| `answer_question` | `{ questionId, answer: string\|number\|boolean\|string[] }` | anonymous | `VoiceJourney` |
| `get_current_journey` | `{}` | anonymous | `VoiceJourney` |
| `explain_step` | `{ stepId: NodeId }` | anonymous | `VoiceJourney` scoped to one step |
| `save_preference` | `{ key: "preferred_language"\|"response_style"\|"district", value ≤60 }` | RECOGNIZED | `{ status: "SAVED", key, value }` |
| `forget_my_data` | `{}` | RECOGNIZED | `{ status: "FORGOTTEN", removed, say }` |
| `resume_journey` | `{}` | VERIFIED | `VoiceJourney` |

`answer_question`'s `questionId` must be a question the current compile actually
asked, or a document currently on the journey. Anything else is
`INVALID_ARGUMENTS` — it is not a general "set a field" call.

`explain_step`'s `stepId` is searched in **this citizen's compiled path**, not
the graph. A node that exists but is not on their journey is `NOT_FOUND`.

**`VoiceJourney`** (`packages/voice/src/projection.ts`) — the compact projection
the model gets, and the same one `/api/voice/context` returns:

```json
{
  "status": "NEEDS_INPUT",
  "service": { "id": "service:income_certificate", "name": "Income Certificate" },
  "jurisdiction": "Ahmedabad",
  "summary": "3 steps left, 2 documents to prepare, 1 office visit",
  "nextQuestion": { "id": "household_size", "prompt": "How many people live in your household?", "inputType": "NUMBER", "options": [] },
  "nextBestAction": { "stepId": "service:income_certificate", "title": "Apply", "whatToDo": "…" },
  "documents": { "readyCount": 1, "neededCount": 2, "mostImportantMissing": "Ration card", "needed": ["Aadhaar card", "Ration card"] },
  "office": { "name": "…", "line": "…" },
  "stepsRemaining": 3,
  "unverified": false,
  "speakableFacts": [{ "claimId": "service:…", "text": "Rs. 20", "sourceId": "src:…" }]
}
```

It is a **voice** projection: one question, one next action, counts not lists,
and `needed` capped at six names. For a full journey panel, compile the same
service through `/api/journeys/compile` — it is the same compiler on the same
session state, so the two cannot disagree. `unverified: true` is the
journey-level version of `machineExtracted` and must be shown.

## GET `/api/voice/context`

What the screen should show. `?sessionId=…` plus the bearer token.

Read-only, spends no tool budget, takes no arguments beyond the session it
authenticates. Poll it, or refresh it after each tool result.

**Response `200`**

```json
{
  "sessionId": "9f1c…",
  "identityLevel": "ANONYMOUS",
  "allowedTools": ["resolve_need", "…"],
  "jurisdiction": { "country": "IN", "state": "GJ" },
  "language": "gu",
  "expiresAt": 1780000600000,
  "journey": null
}
```

`journey` is a `VoiceJourney` or **`null`** — null rather than absent, so the
panel renders an empty state instead of reading as a bug. `language` is `null`
until the caller picks one.

`identityLevel` and `allowedTools` can change mid-call (a `forget_my_data` or a
downgrade drops them). Re-read them here rather than caching what
`/api/voice/session` returned.

**Errors** — `400` missing `sessionId` or token. `401` bad or expired token.
`503` voice not configured.

## POST `/api/voice/vapi/webhook`

Telephony. **Not for the frontend** — documented so nobody mistakes it for a
public endpoint.

Vapi signs each payload; the raw bytes are verified before a single field is
read. `x-vapi-signature: t=<ms>,v1=<hex>` over `<t>.<body>`, HMAC-SHA256 with
`VAPI_WEBHOOK_SECRET`, five minute replay window either way. The
`x-vapi-secret` bearer form is also accepted (constant-time) because the Vapi
dashboard sets it up by default.

An unsigned, stale or forged request gets **`401` `{"error":"unauthorized"}`**
and no explanation.

The session is found by the provider's call id, never by anything in the body
claiming to be one. Tool calls run sequentially against the one session and the
one budget.

---

# Notes for the UI

**Nothing here needs a key.** The graph routes are public and the voice routes
mint their own credential. No `.env` value ever reaches the browser; if you find
yourself wanting `NEXT_PUBLIC_OPENAI_…`, that is the bug.

**Empty is an answer.** `matches: []`, `candidates: []`, `journey: null` — every
one of them means "we have not mapped that", and the product's whole claim is
that it says so rather than inventing something plausible.

**Provenance is not optional chrome.** Every government claim carries a
`sourceId`; `machineExtracted` / `unverified` mean no human has read the page.
Both need to be visible.

**Voice and screen share one journey.** `/api/voice/context` and
`/api/journeys/compile` run the same compiler over the same answers. If they
disagree, that is a bug worth filing, not a rendering choice.
