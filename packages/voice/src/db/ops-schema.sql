-- Ariane operations schema: capacity, queue, limits, security, observability.
--
-- `voice-schema.sql` next door holds the small amount we know about individual
-- people. This file holds what the *service* knows about itself: who is on a
-- line right now, who is waiting, who has been rate limited, what was said, and
-- what somebody tried. Same rule as next door, for the same reason. RLS on,
-- zero policies, execute revoked from anon and authenticated. Everything here
-- is server-only and a leaked publishable key reads none of it.
--
--   psql "$SUPABASE_DB_URL" -f packages/voice/src/db/ops-schema.sql
--
-- Idempotent. Safe to run twice, safe to run against a database that already
-- has some of it.
--
-- Two design notes worth reading before changing anything below.
--
-- 1. Vercel runs many instances. Nothing here may be decided in a Node process.
--    Every admission, promotion and counter increment happens inside one
--    Postgres statement or one advisory-locked function, so two instances
--    racing for the last slot cannot both win. `pg_advisory_xact_lock` is
--    released when the function's implicit transaction commits, and PostgREST
--    gives each RPC call its own transaction, so the lock is held for
--    microseconds and never leaks across requests.
--
-- 2. No raw IP addresses. `ip_hash` is HMAC-SHA256(RATE_LIMIT_SECRET, ip),
--    computed in `ops/net.ts` and truncated. The key is not in this database,
--    so a dump of these tables is not a list of who visited.

-- ===========================================================================
-- Capacity: at most N expensive voice sessions, globally
-- ===========================================================================

/**
 * One lease is one live realtime session. The row *is* the slot: capacity is
 * `count(*)` over unexpired leases and nothing else, so there is no counter to
 * drift and no cache to invalidate.
 *
 * A lease outlives its heartbeat by design. `lease_expires_at` is pushed
 * forward on every heartbeat, so a browser that closes its laptop lid stops
 * heartbeating and its slot returns to the pool on its own. Nothing depends on
 * a client releasing politely.
 */
create table if not exists voice_capacity_leases (
  session_id       uuid primary key,
  auth_user_id     uuid,
  ip_hash          text,
  acquired_at      timestamptz not null default now(),
  heartbeat_at     timestamptz not null default now(),
  lease_expires_at timestamptz not null
);

create index if not exists voice_leases_expiry_idx on voice_capacity_leases (lease_expires_at);

/**
 * FIFO, by `created_at`, and the position is derived rather than stored: a
 * stored position is a number that goes wrong the moment somebody leaves.
 *
 * WAITING  -> in line
 * ADMITTED -> a slot is being held for them, `claim_expires_at` is ticking
 * CLAIMED  -> they took it; a lease exists
 * LEFT     -> pressed the button
 * EXPIRED  -> stopped polling, or did not claim in time
 */
create table if not exists voice_queue (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid,
  ip_hash           text,
  status            text not null default 'WAITING'
                      check (status in ('WAITING', 'ADMITTED', 'CLAIMED', 'LEFT', 'EXPIRED')),
  -- Handed out only at promotion, checked at claim. Without it, knowing a
  -- ticket id would be enough to take somebody else's slot.
  claim_token       text,
  claim_expires_at  timestamptz,
  -- Stops polling and the row is rubbish. Pushed forward by each poll.
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  admitted_at       timestamptz,
  waited_ms         integer
);

create index if not exists voice_queue_fifo_idx on voice_queue (status, created_at);
create index if not exists voice_queue_expiry_idx on voice_queue (expires_at);

-- ===========================================================================
-- Rate limiting and cooldowns
-- ===========================================================================

/**
 * Fixed window counters, keyed by an opaque string the caller builds
 * (`voice:create:<ip_hash>`, `auth:email:<hash>`, …).
 *
 * ponytail: fixed window, not sliding. A caller can spend a full budget at the
 * end of one window and another at the start of the next, so the real burst
 * ceiling is 2x for one instant. That is acceptable for every limit here and it
 * costs one row and one statement. Move to a sliding window only if a real
 * abuser is seen riding the boundary.
 */
create table if not exists ariane_rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);

create index if not exists rate_limits_window_idx on ariane_rate_limits (window_start);

/**
 * A guest's one free minute, spent in milliseconds rather than in requests.
 *
 * Two subjects are charged for the same call: the signed guest cookie and the
 * IP hash. Clearing cookies gets you a new cookie subject and the same IP
 * subject, and the stricter of the two decides. That is the whole
 * anti-refresh mechanism and it is deliberately not clever.
 */
create table if not exists voice_guest_usage (
  subject      text        not null,
  window_start timestamptz not null,
  ms_used      bigint      not null default 0,
  primary key (subject, window_start)
);

/** A subject that may not start a voice session yet, and why. */
create table if not exists ariane_cooldowns (
  subject    text primary key,
  until      timestamptz not null,
  reason     text        not null,
  created_at timestamptz not null default now()
);

create index if not exists cooldowns_until_idx on ariane_cooldowns (until);

-- ===========================================================================
-- Security events
-- ===========================================================================

/**
 * What somebody tried, and what we did about it.
 *
 * `safe_excerpt` is redacted in `guardrails.redact` before it ever gets here
 * and is capped by a check constraint as well, because "we redact it upstream"
 * is a sentence that stops being true one refactor later. `input_hash` is what
 * lets an operator see the same probe arriving from thirty IPs without anybody
 * storing thirty copies of the sentence.
 *
 * Nothing in here authorizes anything. A row is a record, and the cooldown that
 * may follow it is decided by server policy in `ops/security.ts`, never by a
 * classifier and never by the model.
 */
create table if not exists security_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  session_id   uuid,
  auth_user_id uuid,
  ip_hash      text,
  category     text not null,
  severity     text not null check (severity in ('LOW', 'MEDIUM', 'HIGH')),
  action_taken text not null,
  safe_excerpt text check (safe_excerpt is null or length(safe_excerpt) <= 300),
  input_hash   text,
  metadata     jsonb not null default '{}'
);

create index if not exists security_events_time_idx on security_events (created_at desc);
create index if not exists security_events_ip_idx on security_events (ip_hash, created_at desc);
create index if not exists security_events_sev_idx on security_events (severity, created_at desc);
create index if not exists security_events_session_idx on security_events (session_id);

-- ===========================================================================
-- Product telemetry
-- ===========================================================================

/**
 * Ariane's own funnel. Allowlisted event names only; the allowlist lives in
 * `ops/events.ts` and is checked before insert, so this table cannot become a
 * dumping ground one `track()` call at a time.
 *
 * `metadata` carries structure, never content. `{ questionId }` and never
 * `{ answer }`. That is a rule the application holds; the column cannot.
 */
create table if not exists app_events (
  id                   bigint generated always as identity primary key,
  created_at           timestamptz not null default now(),
  anonymous_session_id text,
  auth_user_id         uuid,
  ip_hash              text,
  event_name           text not null,
  path                 text,
  service_id           text,
  journey_id           text,
  metadata             jsonb not null default '{}'
);

create index if not exists app_events_time_idx on app_events (created_at desc);
create index if not exists app_events_name_idx on app_events (event_name, created_at desc);
create index if not exists app_events_user_idx on app_events (auth_user_id, created_at desc);
create index if not exists app_events_anon_idx on app_events (anonymous_session_id, created_at desc);
create index if not exists app_events_service_idx on app_events (service_id);

-- ===========================================================================
-- Voice observability
-- ===========================================================================

/**
 * One call, for an operator to read afterwards.
 *
 * Text only. There is no audio column and there is no place to put one: the
 * browser talks to the realtime provider directly over WebRTC and the audio
 * never touches this server. What is written down is what the client posts back
 * as transcript, redacted on arrival.
 */
create table if not exists voice_conversations (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null unique,
  auth_user_id        uuid,
  citizen_id          uuid references voice_citizens (id) on delete set null,
  ip_hash             text,
  tier                text not null default 'GUEST' check (tier in ('GUEST', 'AUTHENTICATED')),
  identity_level      text not null,
  provider            text not null default 'BROWSER',
  language            text,
  service_id          text,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  duration_ms         integer,
  queue_wait_ms       integer,
  end_reason          text,
  turn_count          integer not null default 0,
  tool_count          integer not null default 0,
  risk_score          integer not null default 0,
  input_audio_tokens  integer,
  output_audio_tokens integer,
  estimated_cost      numeric(12, 4),
  created_at          timestamptz not null default now()
);

create index if not exists conversations_time_idx on voice_conversations (started_at desc);
create index if not exists conversations_user_idx on voice_conversations (auth_user_id, started_at desc);
create index if not exists conversations_citizen_idx on voice_conversations (citizen_id, started_at desc);
create index if not exists conversations_ip_idx on voice_conversations (ip_hash, started_at desc);
create index if not exists conversations_risk_idx on voice_conversations (risk_score desc, started_at desc);

/**
 * One line of the transcript. `text` arrives redacted; the length cap is a
 * second wall so a runaway client cannot turn this into blob storage.
 */
create table if not exists voice_turns (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references voice_conversations (id) on delete cascade,
  sequence         integer not null,
  role             text not null check (role in ('USER', 'ASSISTANT', 'TOOL')),
  text             text not null check (length(text) <= 4000),
  created_at       timestamptz not null default now(),
  latency_ms       integer,
  guardrail_status text
);

create unique index if not exists turns_seq_idx on voice_turns (conversation_id, sequence);
create index if not exists turns_conversation_idx on voice_turns (conversation_id, created_at);

/**
 * What the broker actually did. `safe_args_json` is redacted and the result is
 * a summary rather than a payload: an operator needs to know that
 * `start_journey` ran and returned four steps, not to have a second copy of the
 * graph in this table.
 */
create table if not exists voice_tool_events (
  id                  bigint generated always as identity primary key,
  conversation_id     uuid not null references voice_conversations (id) on delete cascade,
  tool_name           text not null,
  status              text not null,
  duration_ms         integer,
  safe_args_json      jsonb not null default '{}',
  safe_result_summary text check (safe_result_summary is null or length(safe_result_summary) <= 500),
  created_at          timestamptz not null default now()
);

create index if not exists tool_events_conversation_idx on voice_tool_events (conversation_id, created_at);
create index if not exists tool_events_name_idx on voice_tool_events (tool_name, created_at desc);
create index if not exists tool_events_status_idx on voice_tool_events (status, created_at desc);

-- ===========================================================================
-- Auth linkage
-- ===========================================================================

/**
 * The bridge between Supabase Auth and Ariane.
 *
 * `auth.users` is not reachable over PostgREST and should not be, so this is
 * the projection an admin screen reads: an id, an email, and two timestamps.
 * Written server-side after a verified session, never from an email address the
 * model or the client merely claimed.
 */
create table if not exists ariane_profiles (
  auth_user_id  uuid primary key,
  email         text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  voice_ms      bigint not null default 0,
  login_count   integer not null default 0
);

create index if not exists profiles_last_seen_idx on ariane_profiles (last_seen_at desc);

-- A logged-in caller and a phone caller can be the same person. Nullable and
-- unique: most citizen rows have no auth user and never will.
alter table voice_citizens add column if not exists auth_user_id uuid;
create unique index if not exists citizens_auth_user_idx on voice_citizens (auth_user_id)
  where auth_user_id is not null;

-- ===========================================================================
-- Atomic admission
-- ===========================================================================

/**
 * Take a slot, or do not. The only function that may create a lease.
 *
 * The advisory lock is what makes "check then insert" safe across instances.
 * Without it two functions read `active = 9` in parallel and both insert, and
 * the eleventh caller is on a realtime session nobody is paying for on purpose.
 *
 * Expired leases are swept here rather than by a cron, so capacity self-heals
 * on the next attempt to use it and there is no scheduled job to forget.
 */
create or replace function voice_admit(
  p_session_id  uuid,
  p_auth_user_id uuid,
  p_ip_hash     text,
  p_ttl_ms      integer,
  p_max         integer
) returns jsonb
language plpgsql
as $$
declare
  v_active  integer;
  v_pending integer;
begin
  perform pg_advisory_xact_lock(hashtext('ariane:voice:capacity'));

  delete from voice_capacity_leases where lease_expires_at < now();

  select count(*) into v_active from voice_capacity_leases;
  -- Slots being held for a promoted queue ticket are spoken for. Counting them
  -- is what stops a walk-in taking the slot somebody just waited nine minutes
  -- for.
  select count(*) into v_pending
    from voice_queue
   where status = 'ADMITTED' and claim_expires_at > now();

  if v_active + v_pending >= p_max then
    return jsonb_build_object('admitted', false, 'active', v_active, 'pending', v_pending);
  end if;

  insert into voice_capacity_leases (session_id, auth_user_id, ip_hash, lease_expires_at)
  values (p_session_id, p_auth_user_id, p_ip_hash, now() + make_interval(secs => p_ttl_ms / 1000.0))
  on conflict (session_id) do update
    set lease_expires_at = excluded.lease_expires_at,
        heartbeat_at     = now();

  return jsonb_build_object('admitted', true, 'active', v_active + 1, 'pending', v_pending);
end
$$;

/** Push the lease forward. False when the lease is already gone. */
create or replace function voice_heartbeat(p_session_id uuid, p_ttl_ms integer)
returns boolean
language plpgsql
as $$
declare
  v_hit integer;
begin
  update voice_capacity_leases
     set heartbeat_at     = now(),
         lease_expires_at = now() + make_interval(secs => p_ttl_ms / 1000.0)
   where session_id = p_session_id
     and lease_expires_at > now();
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end
$$;

/** Give the slot back. Idempotent: hanging up twice is not an error. */
create or replace function voice_release(p_session_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_hit integer;
begin
  delete from voice_capacity_leases where session_id = p_session_id;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end
$$;

-- ===========================================================================
-- Queue
-- ===========================================================================

create or replace function voice_queue_join(
  p_auth_user_id uuid,
  p_ip_hash      text,
  p_ttl_ms       integer
) returns jsonb
language plpgsql
as $$
declare
  v_id       uuid;
  v_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('ariane:voice:queue'));

  update voice_queue
     set status = 'EXPIRED'
   where status in ('WAITING', 'ADMITTED') and expires_at < now();

  insert into voice_queue (auth_user_id, ip_hash, expires_at)
  values (p_auth_user_id, p_ip_hash, now() + make_interval(secs => p_ttl_ms / 1000.0))
  returning id into v_id;

  select count(*) + 1 into v_position
    from voice_queue
   where status = 'WAITING' and created_at < (select created_at from voice_queue where id = v_id);

  return jsonb_build_object('ticket', v_id, 'position', v_position);
end
$$;

/**
 * Where am I, and is it my turn yet?
 *
 * Promotion happens here rather than in a background worker: the person at the
 * front of the line is the one polling, so the poll is the cheapest possible
 * place to notice a free slot. No scheduler, nothing to keep running, and the
 * queue cannot stall because a worker died.
 *
 * `p_claim_token` is generated by the caller in Node and only ever written when
 * this ticket is the one being promoted.
 */
create or replace function voice_queue_poll(
  p_ticket      uuid,
  p_max         integer,
  p_claim_ms    integer,
  p_ttl_ms      integer,
  p_claim_token text
) returns jsonb
language plpgsql
as $$
declare
  v_row      voice_queue;
  v_active   integer;
  v_pending  integer;
  v_position integer;
  v_head     uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ariane:voice:queue'));

  update voice_queue
     set status = 'EXPIRED'
   where status in ('WAITING', 'ADMITTED')
     and (expires_at < now() or (status = 'ADMITTED' and claim_expires_at < now()));

  select * into v_row from voice_queue where id = p_ticket;
  if v_row.id is null then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  if v_row.status = 'ADMITTED' then
    return jsonb_build_object(
      'status', 'ADMITTED',
      'position', 0,
      'claimToken', v_row.claim_token,
      'claimExpiresAt', v_row.claim_expires_at,
      'waitedMs', v_row.waited_ms
    );
  end if;

  if v_row.status <> 'WAITING' then
    return jsonb_build_object('status', v_row.status);
  end if;

  -- Still waiting: push the expiry out, because polling is the proof of life.
  update voice_queue
     set expires_at = now() + make_interval(secs => p_ttl_ms / 1000.0)
   where id = p_ticket;

  delete from voice_capacity_leases where lease_expires_at < now();
  select count(*) into v_active from voice_capacity_leases;
  select count(*) into v_pending
    from voice_queue where status = 'ADMITTED' and claim_expires_at > now();

  select count(*) + 1 into v_position
    from voice_queue
   where status = 'WAITING' and created_at < v_row.created_at;

  if v_active + v_pending < p_max then
    select id into v_head
      from voice_queue
     where status = 'WAITING'
     order by created_at
     limit 1;

    if v_head = p_ticket then
      update voice_queue
         set status           = 'ADMITTED',
             claim_token      = p_claim_token,
             claim_expires_at = now() + make_interval(secs => p_claim_ms / 1000.0),
             admitted_at      = now(),
             waited_ms        = (extract(epoch from (now() - created_at)) * 1000)::integer
       where id = p_ticket;

      return jsonb_build_object(
        'status', 'ADMITTED',
        'position', 0,
        'claimToken', p_claim_token,
        'claimExpiresAt', now() + make_interval(secs => p_claim_ms / 1000.0),
        'waitedMs', (extract(epoch from (now() - v_row.created_at)) * 1000)::integer
      );
    end if;
  end if;

  return jsonb_build_object('status', 'WAITING', 'position', v_position, 'active', v_active);
end
$$;

/**
 * Turn a promotion into a lease, atomically, or fail.
 *
 * The claim token must match. A ticket id alone is not enough, so guessing or
 * replaying somebody else's ticket gets nothing.
 */
create or replace function voice_queue_claim(
  p_ticket      uuid,
  p_claim_token text,
  p_session_id  uuid,
  p_ttl_ms      integer,
  p_max         integer
) returns jsonb
language plpgsql
as $$
declare
  v_row    voice_queue;
  v_active integer;
begin
  perform pg_advisory_xact_lock(hashtext('ariane:voice:capacity'));

  select * into v_row
    from voice_queue
   where id = p_ticket
     and status = 'ADMITTED'
     and claim_expires_at > now()
     and claim_token is not null
     and claim_token = p_claim_token;

  if v_row.id is null then
    return jsonb_build_object('admitted', false, 'reason', 'NO_CLAIM');
  end if;

  delete from voice_capacity_leases where lease_expires_at < now();
  select count(*) into v_active from voice_capacity_leases;
  if v_active >= p_max then
    return jsonb_build_object('admitted', false, 'reason', 'FULL');
  end if;

  insert into voice_capacity_leases (session_id, auth_user_id, ip_hash, lease_expires_at)
  values (p_session_id, v_row.auth_user_id, v_row.ip_hash,
          now() + make_interval(secs => p_ttl_ms / 1000.0))
  on conflict (session_id) do update set lease_expires_at = excluded.lease_expires_at;

  update voice_queue set status = 'CLAIMED' where id = p_ticket;

  return jsonb_build_object('admitted', true, 'waitedMs', v_row.waited_ms);
end
$$;

create or replace function voice_queue_leave(p_ticket uuid)
returns boolean
language plpgsql
as $$
declare
  v_hit integer;
begin
  update voice_queue set status = 'LEFT' where id = p_ticket and status in ('WAITING', 'ADMITTED');
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end
$$;

-- ===========================================================================
-- Rate limiting
-- ===========================================================================

/**
 * One request against one bucket. Returns whether it is allowed.
 *
 * The increment and the read are the same statement, so two instances cannot
 * both see "9 of 10" and both proceed. The window is floored rather than
 * rolling, which is what keeps this a single upsert.
 */
create or replace function ariane_rate_limit(
  p_key            text,
  p_window_seconds integer,
  p_max            integer
) returns jsonb
language plpgsql
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into ariane_rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = ariane_rate_limits.count + 1
  returning count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_max,
    'count', v_count,
    'limit', p_max,
    'resetAt', v_window + make_interval(secs => p_window_seconds)
  );
end
$$;

/**
 * Spend a guest's free milliseconds against every subject at once.
 *
 * All subjects are charged and the *most* spent decides, so a new cookie does
 * not buy a new minute while the IP still remembers the last one.
 */
create or replace function voice_guest_consume(
  p_subjects       text[],
  p_ms             bigint,
  p_budget_ms      bigint,
  p_window_seconds integer
) returns jsonb
language plpgsql
as $$
declare
  v_window timestamptz;
  v_used   bigint;
  v_worst  bigint := 0;
  s        text;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  foreach s in array p_subjects loop
    insert into voice_guest_usage (subject, window_start, ms_used)
    values (s, v_window, greatest(0, p_ms))
    -- `greatest(0, ...)`: p_ms is negative when a reservation is refunded after
    -- a failed admission, and a double refund must not mint free minutes.
    on conflict (subject, window_start) do update
      set ms_used = greatest(0, voice_guest_usage.ms_used + p_ms)
    returning ms_used into v_used;
    if v_used > v_worst then v_worst := v_used; end if;
  end loop;

  return jsonb_build_object(
    'allowed', v_worst <= p_budget_ms,
    'usedMs', v_worst,
    'remainingMs', greatest(0, p_budget_ms - v_worst),
    'resetAt', v_window + make_interval(secs => p_window_seconds)
  );
end
$$;

/** Read a guest's spend without charging for it. For the "how long do I get" UI. */
create or replace function voice_guest_remaining(
  p_subjects       text[],
  p_budget_ms      bigint,
  p_window_seconds integer
) returns jsonb
language plpgsql
as $$
declare
  v_window timestamptz;
  v_worst  bigint := 0;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  select coalesce(max(ms_used), 0) into v_worst
    from voice_guest_usage
   where subject = any(p_subjects) and window_start = v_window;
  return jsonb_build_object('usedMs', v_worst, 'remainingMs', greatest(0, p_budget_ms - v_worst));
end
$$;

-- ===========================================================================
-- Observability writes
-- ===========================================================================

/**
 * Append a transcript line and bump the conversation's counter in one shot.
 *
 * The sequence is computed inside the insert rather than read first and written
 * second. Two turns arriving in the same instant from two instances would
 * otherwise both read `max = 4` and both write `5`; here the subselect happens
 * under the row lock the update takes, and the unique index on
 * `(conversation_id, sequence)` is the backstop if that reasoning is ever
 * wrong.
 */
create or replace function voice_append_turn(
  p_conversation_id  uuid,
  p_role             text,
  p_text             text,
  p_latency_ms       integer,
  p_guardrail_status text
) returns void
language plpgsql
as $$
begin
  insert into voice_turns (conversation_id, sequence, role, text, latency_ms, guardrail_status)
  select p_conversation_id,
         coalesce((select max(sequence) from voice_turns where conversation_id = p_conversation_id), 0) + 1,
         p_role,
         left(p_text, 4000),
         p_latency_ms,
         p_guardrail_status;

  update voice_conversations set turn_count = turn_count + 1 where id = p_conversation_id;
end
$$;

create or replace function voice_record_tool(
  p_conversation_id uuid,
  p_tool_name       text,
  p_status          text,
  p_duration_ms     integer,
  p_safe_args       jsonb,
  p_safe_result     text
) returns void
language plpgsql
as $$
begin
  insert into voice_tool_events
    (conversation_id, tool_name, status, duration_ms, safe_args_json, safe_result_summary)
  values
    (p_conversation_id, p_tool_name, p_status, p_duration_ms, coalesce(p_safe_args, '{}'), left(p_safe_result, 500));

  update voice_conversations set tool_count = tool_count + 1 where id = p_conversation_id;
end
$$;

/**
 * First seen, last seen, and how many times they have logged in.
 *
 * Called only after a verified Supabase session, never from an email address
 * that arrived in a request body or a model turn.
 */
create or replace function ariane_touch_profile(
  p_auth_user_id uuid,
  p_email        text,
  p_login        boolean
) returns void
language plpgsql
as $$
begin
  insert into ariane_profiles (auth_user_id, email, login_count)
  values (p_auth_user_id, p_email, case when p_login then 1 else 0 end)
  on conflict (auth_user_id) do update
    set last_seen_at = now(),
        email        = coalesce(excluded.email, ariane_profiles.email),
        login_count  = ariane_profiles.login_count + case when p_login then 1 else 0 end;
end
$$;

-- ===========================================================================
-- Retention
-- ===========================================================================

/**
 * §17's retention policy, as one function an operator or a scheduled job can
 * call. Periods are parameters rather than constants so `ops/retention.ts` owns
 * the numbers and this file owns the deletion.
 *
 * Safe to call as often as you like, and safe never to call: nothing else
 * depends on it having run.
 */
create or replace function ariane_cleanup(
  p_transcript_days integer default 30,
  p_security_days   integer default 90,
  p_event_days      integer default 365,
  p_ephemeral_days  integer default 7
) returns jsonb
language plpgsql
as $$
declare
  v_conversations integer;
  v_security      integer;
  v_events        integer;
  v_queue         integer;
  v_sessions      integer;
  v_limits        integer;
begin
  -- Turns and tool events cascade from the conversation.
  delete from voice_conversations where started_at < now() - make_interval(days => p_transcript_days);
  get diagnostics v_conversations = row_count;

  delete from security_events where created_at < now() - make_interval(days => p_security_days);
  get diagnostics v_security = row_count;

  delete from app_events where created_at < now() - make_interval(days => p_event_days);
  get diagnostics v_events = row_count;

  delete from voice_queue where created_at < now() - make_interval(days => p_ephemeral_days);
  get diagnostics v_queue = row_count;

  delete from voice_sessions where expires_at < now() - make_interval(days => p_ephemeral_days);
  get diagnostics v_sessions = row_count;

  delete from ariane_rate_limits where window_start < now() - make_interval(days => p_ephemeral_days);
  get diagnostics v_limits = row_count;

  delete from voice_guest_usage where window_start < now() - make_interval(days => p_ephemeral_days);
  delete from ariane_cooldowns where until < now() - make_interval(days => p_ephemeral_days);
  delete from voice_capacity_leases where lease_expires_at < now() - interval '1 hour';

  return jsonb_build_object(
    'conversations', v_conversations,
    'securityEvents', v_security,
    'appEvents', v_events,
    'queueRows', v_queue,
    'voiceSessions', v_sessions,
    'rateLimitRows', v_limits
  );
end
$$;

-- ===========================================================================
-- Lock it down
-- ===========================================================================

-- Same reasoning as `voice-schema.sql`: RLS on, no policies, so Postgres denies
-- every row to every role that is not the service role or the owner. These
-- tables describe how the service is being used and by whom; none of it is a
-- citizen's to read and none of it is anonymous's.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'voice_capacity_leases', 'voice_queue', 'ariane_rate_limits', 'voice_guest_usage',
    'ariane_cooldowns', 'security_events', 'app_events', 'voice_conversations',
    'voice_turns', 'voice_tool_events', 'ariane_profiles'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

/**
 * And the functions, which is the half that is easy to forget.
 *
 * A `security invoker` function still runs as whoever called it, so RLS above
 * already stops an anon key from doing anything useful with `voice_admit`. But
 * `execute` granted to `public` means a leaked publishable key can at least
 * call them and watch the errors, and `ariane_cleanup` is a `delete` with a
 * friendly name. Revoke, then grant back to exactly the two roles that run
 * server side.
 */
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'voice_admit', 'voice_heartbeat', 'voice_release', 'voice_queue_join',
         'voice_queue_poll', 'voice_queue_claim', 'voice_queue_leave',
         'ariane_rate_limit', 'voice_guest_consume', 'voice_guest_remaining',
         'voice_append_turn', 'voice_record_tool', 'ariane_touch_profile',
         'ariane_cleanup'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
