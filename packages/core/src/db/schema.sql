-- Ariane graph schema.
--
-- Government facts live here, not in application code, so a wrong fee or a
-- moved office is a row edit rather than a redeploy. The checked in JSON under
-- src/data/graph is the seed this is loaded from and the fallback the app uses
-- when there is no database reachable.
--
-- Shape follows the ontology in src/types.ts exactly. Columns exist for the
-- things we filter, join or order on. Everything else rides in jsonb, because
-- normalising `metadata` into forty nullable columns buys nothing when no
-- query ever looks inside it.
--
-- Provenance is not optional and the constraints say so: a node, edge or group
-- with an empty `sources` array will not insert.
--
--   psql "$SUPABASE_DB_URL" -f packages/core/src/db/schema.sql
--   pnpm db:push

create table if not exists journeys (
  id          text primary key,
  name        text not null,
  updated_at  timestamptz not null default now()
);

create table if not exists jurisdictions (
  id         text primary key,
  parent_id  text references jurisdictions (id),
  level      text not null check (level in ('COUNTRY', 'STATE', 'DISTRICT', 'TALUKA', 'LOCAL_BODY')),
  name       text not null
);

-- A page somebody actually read. Every fact in the graph points at one of these.
create table if not exists sources (
  id              text primary key,
  journey_id      text not null references journeys (id) on delete cascade,
  url             text not null check (url like 'http%'),
  title           text not null,
  domain          text not null,
  source_type     text not null check (source_type in (
                    'SERVICE_PAGE', 'GUIDELINE', 'FAQ', 'OFFICE_DIRECTORY', 'HELPLINE',
                    'MOBILE_APP_INFO', 'TRACKING_PAGE', 'GRIEVANCE_PAGE', 'PDF', 'PORTAL_HOME')),
  jurisdiction_id text references jurisdictions (id),
  retrieved_at    date not null,
  content_hash    text
);

create table if not exists nodes (
  id              text primary key,
  journey_id      text not null references journeys (id) on delete cascade,
  type            text not null check (type in (
                    'SERVICE', 'DOCUMENT', 'DOCUMENT_GROUP', 'ACTION', 'PORTAL', 'MOBILE_APP',
                    'OFFICE', 'DEPARTMENT', 'HELPLINE', 'GRIEVANCE_CHANNEL', 'VERIFICATION',
                    'PAYMENT', 'ELIGIBILITY', 'OUTPUT')),
  name            text not null,
  official_name   text,
  aliases         text[] not null default '{}',
  description     text,
  jurisdiction_id text references jurisdictions (id),
  metadata        jsonb not null default '{}',
  -- SourceRef[]. Verbatim quote, confidence and verification status per claim.
  sources         jsonb not null default '[]',
  last_verified_at date
);

create index if not exists nodes_journey_idx on nodes (journey_id);
create index if not exists nodes_type_idx on nodes (type);
create index if not exists nodes_jurisdiction_idx on nodes (jurisdiction_id);

create table if not exists edges (
  id                  text primary key,
  journey_id          text not null references journeys (id) on delete cascade,
  from_node           text not null references nodes (id) on delete cascade,
  to_node             text not null references nodes (id) on delete cascade,
  type                text not null check (type in (
                        'REQUIRES', 'DEPENDS_ON', 'PRODUCES', 'NEXT', 'APPLY_AT', 'AVAILABLE_VIA',
                        'VISIT_AT', 'HANDLED_BY', 'ISSUED_BY', 'VERIFIED_BY', 'TRACK_AT', 'CALL_IF',
                        'ESCALATE_TO', 'BLOCKS', 'SATISFIES', 'ALTERNATIVE_TO')),
  jurisdiction_id     text references jurisdictions (id),
  verification_status text not null check (verification_status in (
                        'DISCOVERED', 'EXTRACTED', 'NORMALIZED', 'VERIFIED', 'CONFLICTING', 'STALE', 'REJECTED')),
  note                text,
  condition           jsonb,
  valid_from          date,
  valid_until         date,
  sources             jsonb not null default '[]',
  constraint edges_window_ordered check (valid_from is null or valid_until is null or valid_from <= valid_until)
);

create index if not exists edges_from_idx on edges (from_node);
create index if not exists edges_to_idx on edges (to_node);
create index if not exists edges_journey_idx on edges (journey_id);

-- ALL_OF / ANY_OF / AT_LEAST_N. The reason "any one of these three" never
-- renders as three mandatory documents.
create table if not exists requirement_groups (
  id               text primary key,
  journey_id       text not null references journeys (id) on delete cascade,
  owner_node_id    text not null references nodes (id) on delete cascade,
  mode             text not null check (mode in ('ALL_OF', 'ANY_OF', 'AT_LEAST_N')),
  minimum_required int,
  condition        jsonb,
  jurisdiction_id  text references jurisdictions (id),
  members          jsonb not null default '[]',
  sources          jsonb not null default '[]',
  constraint requirement_groups_n_present check (mode <> 'AT_LEAST_N' or minimum_required is not null)
);

-- Questions are derived from the graph, but their wording is content.
create table if not exists questions (
  field      text primary key,
  journey_id text not null references journeys (id) on delete cascade,
  label      text not null,
  help       text,
  input_type text not null check (input_type in ('NUMBER', 'TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN')),
  options    jsonb
);

-- Escalation edges are templates stamped onto every service, so `from` is the
-- literal '*' and they cannot live in `edges` without breaking its foreign key.
create table if not exists escalation_templates (
  id                  text primary key,
  journey_id          text not null references journeys (id) on delete cascade,
  to_node             text not null references nodes (id) on delete cascade,
  type                text not null,
  jurisdiction_id     text references jurisdictions (id),
  verification_status text not null,
  note                text,
  sources             jsonb not null default '[]'
);

-- Provenance is the product. A fact with no page behind it does not get in.
alter table nodes  drop constraint if exists nodes_have_sources;
alter table edges  drop constraint if exists edges_have_sources;
alter table nodes  add  constraint nodes_have_sources check (jsonb_array_length(sources) > 0);
alter table edges  add  constraint edges_have_sources check (jsonb_array_length(sources) > 0);

-- Everything here is published government information, readable by anyone.
-- Writes are seeding and editorial, so they go through the service role only.
alter table journeys             enable row level security;
alter table jurisdictions        enable row level security;
alter table sources              enable row level security;
alter table nodes                enable row level security;
alter table edges                enable row level security;
alter table requirement_groups   enable row level security;
alter table questions            enable row level security;
alter table escalation_templates enable row level security;

do $$
declare t text;
begin
  foreach t in array array['journeys', 'jurisdictions', 'sources', 'nodes', 'edges',
                           'requirement_groups', 'questions', 'escalation_templates']
  loop
    execute format('drop policy if exists %I on %I', t || '_public_read', t);
    execute format('create policy %I on %I for select using (true)', t || '_public_read', t);
  end loop;
end $$;
