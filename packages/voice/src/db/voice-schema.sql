-- Ariane voice schema.
--
-- The graph schema next door holds published government facts and lets anyone
-- read them. This file holds the opposite kind of data: a small amount about
-- individual people, and the rule here is the mirror image. No public read, no
-- anon policy, no policy at all. RLS is on and every table is empty of grants,
-- so the only thing that can reach these rows is the service role, server side.
--
-- §11: the phone number is never stored. `phone_hash` is a keyed HMAC computed
-- in `identity.ts` from the E.164 form, and the key is not in this database. A
-- dump of these tables does not give anyone a list of who called.
--
--   psql "$SUPABASE_DB_URL" -f packages/voice/src/db/voice-schema.sql

-- A person we were asked to remember. A row exists only after consent.
create table if not exists voice_citizens (
  id                 uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 of the E.164 number, keyed by VOICE_PHONE_HMAC_SECRET.
  -- Unique because it is the lookup key; not the primary key because rotating
  -- the HMAC secret must not orphan every child row.
  phone_hash         text not null unique,
  preferred_language text check (preferred_language in ('en', 'hi', 'gu')),
  district           text,
  consent_state      text not null default 'UNKNOWN' check (consent_state in ('UNKNOWN', 'GRANTED', 'DENIED')),
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

-- §12 in a constraint. Three keys, short values, and no `remember(text)`.
-- Anything a caller says that does not fit one of these three is not kept.
create table if not exists voice_citizen_preferences (
  citizen_id uuid not null references voice_citizens (id) on delete cascade,
  key        text not null check (key in ('preferred_language', 'response_style', 'district')),
  value      text not null check (length(value) <= 60),
  updated_at timestamptz not null default now(),
  primary key (citizen_id, key)
);

-- A journey in progress, so a caller who runs out of time can pick it up.
-- Answers are the citizen's own facts, keyed by the field the graph asked for,
-- never free text and never a transcript.
create table if not exists voice_citizen_journeys (
  id              text primary key,
  citizen_id      uuid not null references voice_citizens (id) on delete cascade,
  service_id      text not null,
  answers_json    jsonb not null default '{}',
  documents_json  jsonb not null default '[]',
  status          text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists voice_journeys_citizen_idx on voice_citizen_journeys (citizen_id, updated_at desc);

-- What they told us they hold. `source` distinguishes a claim from a check;
-- nothing today writes VERIFIED, and the column exists so that when something
-- does, "they said so" and "we saw it" are not the same row.
create table if not exists voice_citizen_documents (
  citizen_id  uuid not null references voice_citizens (id) on delete cascade,
  document_id text not null,
  status      text not null check (status in ('HELD', 'MISSING', 'EXPIRED')),
  source      text not null default 'CITIZEN_SAID' check (source in ('CITIZEN_SAID', 'VERIFIED')),
  updated_at  timestamptz not null default now(),
  primary key (citizen_id, document_id)
);

-- One call. Short lived by construction: `expires_at` is set at creation from
-- LIMITS.maxCallMs and nothing extends it.
--
-- `citizen_id` is set by the server from the caller hash or from a completed
-- step-up. Nothing the model or the browser sends can write this column, which
-- is §9 expressed as a place no untrusted input reaches.
create table if not exists voice_sessions (
  id                uuid primary key,
  provider          text not null check (provider in ('BROWSER', 'VAPI')),
  provider_call_id  text,
  citizen_id        uuid references voice_citizens (id) on delete set null,
  phone_hash        text,
  identity_level    text not null check (identity_level in ('ANONYMOUS', 'RECOGNIZED', 'VERIFIED')),
  allowed_tools     text[] not null default '{}',
  active_journey_id text,
  -- Jurisdiction, language, budget counters, the in-flight journey. Columns
  -- exist for what a query filters on and no query filters on a budget counter.
  session_state     jsonb not null default '{}',
  -- SHA-256 of the bearer token, keyed by VOICE_SESSION_SECRET. The token
  -- itself exists only in the client that was handed it.
  token_hash        text not null,
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED', 'REVOKED'))
);

create index if not exists voice_sessions_caller_idx on voice_sessions (phone_hash, started_at desc);
create index if not exists voice_sessions_call_idx on voice_sessions (provider_call_id);

-- §28. RLS on, and deliberately no policies: with RLS enabled and no policy,
-- Postgres denies every row to every role that is not the service role or the
-- table owner. A leaked publishable key reads nothing here.
alter table voice_citizens             enable row level security;
alter table voice_citizen_preferences  enable row level security;
alter table voice_citizen_journeys     enable row level security;
alter table voice_citizen_documents    enable row level security;
alter table voice_sessions             enable row level security;

-- Belt and braces, in case a previous run of this file or a dashboard click
-- ever created one.
do $$
declare t text; p record;
begin
  foreach t in array array['voice_citizens', 'voice_citizen_preferences', 'voice_citizen_journeys',
                           'voice_citizen_documents', 'voice_sessions']
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- §19: a session row is call state, not a record of the call. Nothing above
-- stores audio, a transcript, or what was said. Expired sessions are rubbish
-- and this is how they leave; run it from a cron, or by hand.
--
--   delete from voice_sessions where expires_at < now() - interval '7 days';
