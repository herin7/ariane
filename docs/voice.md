# Voice

Ariane, on the phone and in the browser.

Ariane's rule is `LLM UNDERSTANDS. GRAPH DECIDES. SOURCE PROVES.` Voice adds one
word and changes nothing else:

> **MODEL UNDERSTANDS. ARIANE DECIDES. POLICY AUTHORIZES. SOURCE PROVES.**

The model hears a sentence in Gujarati, works out that somebody's father died,
and proposes a tool call. Every decision after that is ours: which service, which
documents, which question next, whether this caller may see any of it. The model
is never a security boundary, and nothing in this package asks it to be.

## The shape of it

```
browser  ─┐                                             ┌─ compileJourney()
          ├─ session ─→ VoiceBroker ─→ policy ─→ tool ──┤   resolveIntentDeeply()
telephony ┘                 ▲                            └─ VoiceStore
                            │
                    the model proposes; this decides
```

| File | What it is |
| --- | --- |
| `policy.ts` | Deny-by-default table. Which tool at which identity level, and every ceiling. |
| `session.ts` | Who is on the line. Created server-side; nothing external can write to it. |
| `broker.ts` | The only path from a proposed tool call to anything real. |
| `schemas.ts` | Every boundary in Zod, `.strict()` throughout. |
| `guardrails.ts` | Input filter and output grounding check. |
| `projection.ts` | A compiled journey cut down to something a person can hear. |
| `agent.ts` | The instructions and the realtime session config. |
| `identity.ts` | Phone → E.164 → keyed hash. The number never leaves this file. |
| `store.ts` | Five narrow helpers over Postgres. No generic query capability. |
| `transport/` | `browser.ts` mints credentials; `vapi.ts` is the telephony leg. |

`runtime.ts` wires one of each per process. `index.ts` is browser-safe;
`server.ts` holds anything that touches Supabase or a secret; `client.ts` is the
browser's WebRTC half.

## The eight tools

That is the entire capability surface. There is no url, no query, no id
belonging to another person, and no tool whose name contains *execute*, *fetch*,
*run*, *query* or *user* — asserted in `policy.ts` and tested in
`redteam.test.ts`, so adding one fails the suite rather than shipping.

| Tool | Level | Writes |
| --- | --- | --- |
| `resolve_need` | anonymous | — |
| `start_journey` | anonymous | — |
| `answer_question` | anonymous | session only |
| `get_current_journey` | anonymous | — |
| `explain_step` | anonymous | — |
| `save_preference` | RECOGNIZED | one enum key, ≤60 chars |
| `forget_my_data` | RECOGNIZED | deletes |
| `resume_journey` | VERIFIED | — |

Arguments and response shapes: [`routes.md`](routes.md).

Most of Ariane is anonymous on purpose. Making a citizen prove who they are to
read a published fee is the behaviour this product exists against.

## Identity

Three levels, and the distance between the second and the third is the whole of
§10:

- **ANONYMOUS** — everything public, which is nearly everything. A journey that
  shortens as they talk and evaporates when they hang up.
- **RECOGNIZED** — this number has called before *and* consented. Buys a
  greeting in their language and their own preferences. Nothing else.
- **VERIFIED** — an OTP they typed, never spoke. The only level that can read a
  saved journey back to somebody.

**Caller ID is not authentication.** A saved journey can contain that this
person's father died and which certificate they are chasing about it. A
spoofable header does not open that.

The model has no part in any of this. `voice_session_id → citizen_id` is
resolved server-side, out of band, and there is no argument on any tool that
takes a citizen id — which is why the four injection shapes in
`isolation.test.ts` all come back `INVALID_ARGUMENTS` rather than being quietly
ignored. Ignored and read-later are indistinguishable six months from now.

## Memory

There is no `remember(text)`. The only write the model has is
`save_preference`, and it is an enum of three keys with a sixty character value
— a constraint in `voice-schema.sql`, not a convention.

Never stored, by construction rather than by filter: Aadhaar, PAN, bank details,
OTP codes, passwords, health, religion, caste, politics, family death details,
financial distress, addresses, raw transcripts.

`forget_my_data` deletes the citizen row and everything keyed to it, drops the
id off the live session, and downgrades the call to anonymous. Erasing the row
and leaving the id in memory is not erasure.

## Grounding

Everything a projection contains, the model may say. Everything it does not
contain, the model may not say.

`speakableFacts` is that boundary written down: a closed set of claims, each
carrying the source that proves it. `checkOutput` then reads what the model
actually said and looks for a fee, a timeline, a document name, a portal, an
office or a legal assertion that is not in the set. When it finds one the client
issues a self-correction rather than letting it stand.

On any failure — graph down, tool timeout, nothing matched — the answer is "I do
not know" and never the model's general knowledge about Indian government
paperwork. `packages/voice/src/__tests__/broker.test.ts` asserts the upstream
error never becomes a sentence.

## Three layers

1. **Input** — `checkInput` on the one tool that takes free text. Injection
   patterns in English, Hindi, Gujarati and Hinglish, with the ones that are
   never innocent marked severe so they refuse alone. A filter that is stricter
   in English on an Indian product is not a filter.
2. **Broker** — the layer that actually decides. Policy lookup, strict schema,
   session-scoped ids, ceilings. Never trusts an argument because a model
   produced it.
3. **Output** — grounding check before the words stand.

Layer 2 is the one that counts. The other two are for the model's benefit; an
LLM classifier is not access control.

## Ceilings

Server-enforced, in `policy.ts`. No prompt instruction can disable them.

| | |
| --- | --- |
| Call | 10 min, hard stop at 30 |
| Turns / tool calls | 120 / 60 |
| Invalid calls | 10, or 4 failures running → read-only anonymous |
| Same call repeated | 3 → loop |
| Per caller | 2 concurrent, 30 min/day |
| Everyone | 24 h/day of call time |
| Tool timeout | 8 s |
| Arguments | 4 KB |

> `ponytail:` a browser session has no caller id, so the per-caller ceilings
> cannot bind to it — only the global daily one and the per-session ones do.
> Hashing IP+UA was the obvious fix and is worse than the gap: one NAT'd office
> or demo venue would trip `maxConcurrentSessionsPerCaller` on the second
> visitor. Upgrade path is a web sign-in, at which point browser sessions get a
> citizen id and the existing ceilings apply unchanged.

## Recording

Off. All of it: raw call recording, audio storage, PCAP, long-term transcripts.

`ARIANE_VOICE_TRANSCRIBE=1` turns transcription on. The model hears the caller
either way; that flag is what puts their words in a logging pipeline, and it is
a deployment decision with a consent line attached rather than a default.

Never logged: phone number, Aadhaar, PAN, OTP, raw audio, complete transcript,
sensitive documents, memory contents, the system prompt, any credential.
Telemetry is structured events with ids and counts. Langfuse is optional, off
unless all three keys are set, and masked before transmission.

## Database

Five tables in `packages/voice/src/db/voice-schema.sql`, applied once, by hand,
the same way the graph schema is:

```bash
psql "$SUPABASE_DB_URL" -f packages/voice/src/db/voice-schema.sql
```

Until that has run against a deployment with `SUPABASE_URL` set, opening a
session answers `502` and logs the missing table. RLS is on for all five
with **zero policies**, which is deny-all to `anon` and `authenticated`; the
server reaches them with the service role and nothing else does. The file also
revokes explicitly, because a policy that gets added later should not silently
open a table.

`voice_citizens.phone_hash` is a unique column and deliberately **not** the
primary key — rotating `VOICE_PHONE_HMAC_SECRET` would otherwise orphan every
child row. Rotating it makes returning callers strangers, which is a recovery
path rather than a disaster.

Nothing here touches `.ingest/`, `.firecrawl/`, raw scrape files or PDF dumps.
Voice reads the same compiled graph the website does and nothing further back.

## Running it

Two secrets and an Azure AI Foundry realtime deployment, all in the repo-root
`.env`; see `.env.example`. Without them every `/api/voice` route answers `503`
and the rest of Ariane is untouched.

```bash
pnpm --filter @ariane/voice test   # 74 tests
pnpm dev                           # /api/voice/session answers
```

Foundry, specifically, means four values: `AZURE_OPENAI_ENDPOINT` (the resource
root, no path and no `api-version`), `AZURE_OPENAI_API_KEY`, the deployment name
and the voice. Realtime is a global deployment available in East US 2 and Sweden
Central only. The server POSTs the session config to
`/openai/v1/realtime/client_secrets` on that resource and gets back a token good
for about a minute; the browser POSTs its SDP offer to
`/openai/v1/realtime/calls` on the same host, holding only that token. Both
paths are the GA protocol — the preview one used a separate regional host and an
`api-version` parameter, and is deprecated.

Nothing above the handshake is Azure-shaped. If this ever has to move providers,
`transport/browser.ts` and the `callUrl` it returns are the whole surface.

Telephony additionally wants `VAPI_WEBHOOK_SECRET` and a Vapi assistant pointed
at `POST /api/voice/vapi/webhook`. Payloads are HMAC-verified over the raw bytes
with a five minute replay window before a single field is read.

## What is tested

`packages/voice/src/__tests__/`, 70 tests, and two files are the ones that
matter:

- **`isolation.test.ts`** — Citizen B, fully verified as themselves, reaching for
  Citizen A's journey by every route available: resume, four shapes of id
  injection, erasure scope, token reuse across sessions. This is a release gate.
- **`redteam.test.ts`** — prompt extraction in four languages, identity
  argued upward, unasked fields, another service's nodes, every ceiling, and a
  set of ordinary citizen sentences that must *not* be refused. A guardrail that
  refuses "is there any password reset charge for Digital Gujarat" is a
  guardrail that has stopped working.

Both were written as attacks rather than behaviours, and both found real bugs
the first time they ran.
