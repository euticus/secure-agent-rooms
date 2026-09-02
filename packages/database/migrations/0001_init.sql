-- Secure Agent Rooms — Postgres schema (durable shape of the Store interface).
-- Tenancy: every tenant-scoped table carries organization_id and/or room_id
-- with FKs. Application-layer authorization is primary; RLS below is
-- defense-in-depth (T6: cross-tenant application bug).

create extension if not exists pgcrypto;

create table organizations (
  id           text primary key,
  name         text not null,
  created_at   timestamptz not null default now()
);

create table users (
  id            text primary key,
  email         text not null unique,
  display_name  text not null,
  -- scrypt-encoded; null for accounts provisioned by an external IdP.
  password_hash text,
  created_at    timestamptz not null default now()
);

create table organization_memberships (
  id              text primary key,
  organization_id text not null references organizations(id),
  user_id         text not null references users(id),
  role            text not null check (role in ('owner','admin','security_admin','member','auditor')),
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Bearer sessions. Only the SHA-256 hash of the token is stored.
create table sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_expiry on sessions (expires_at);

create table agent_connections (
  id                   text primary key,
  organization_id      text not null references organizations(id),
  name                 text not null,
  adapter_type         text not null check (adapter_type in
    ('A2A_NATIVE','HOSTED_ANTHROPIC','HOSTED_OPENAI','MCP_BRIDGE','PRIVATE_GATEWAY','SCRIPTED')),
  status               text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED','NEEDS_REAPPROVAL')),
  endpoint             text,
  agent_card_hash      text,
  -- Opaque pointer into the secret manager. Secret VALUES never live here.
  credential_reference text,
  config               jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  last_verified_at     timestamptz
);

create table rooms (
  id                      text primary key,
  name                    text not null,
  description             text not null default '',
  created_by_user_id      text not null references users(id),
  creator_org_id          text not null references organizations(id),
  state                   text not null check (state in
    ('DRAFT','INVITED','NEGOTIATING','READY','ACTIVE','PAUSED','COMPLETION_PROPOSED',
     'COMPLETED','CLOSED','CANCELED','QUARANTINED')),
  budget                  jsonb not null,
  usage                   jsonb not null,
  content_retention_days  int not null default 7,
  audit_retention_days    int not null default 365,
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  closed_at               timestamptz
);

create table room_participants (
  id                              text primary key,
  room_id                         text not null references rooms(id),
  organization_id                 text not null references organizations(id),
  role                            text not null check (role in ('customer','provider','peer')),
  agent_connection_id             text references agent_connections(id),
  policy                          jsonb,
  contract_approved_version       int,
  completion_approved_by_user_id  text references users(id),
  joined_at                       timestamptz not null default now(),
  unique (room_id, organization_id)
);

create table invites (
  id                  text primary key,
  room_id             text not null references rooms(id),
  inviting_org_id     text not null references organizations(id),
  target_email        text,
  target_domain       text,
  token_hash          text not null unique,  -- SHA-256(token); raw token never stored
  expires_at          timestamptz not null,
  redeemed_at         timestamptz,
  redeemed_by_user_id text references users(id),
  revoked_at          timestamptz,
  max_redemptions     int not null default 1,
  redemptions         int not null default 0,
  created_by_user_id  text not null references users(id),
  created_at          timestamptz not null default now()
);

create table task_contract_versions (
  id                  text primary key,
  room_id             text not null references rooms(id),
  version             int not null,
  contract            jsonb not null,
  created_by_user_id  text not null references users(id),
  created_at          timestamptz not null default now(),
  unique (room_id, version)
);

-- Append-only. Sequence is server-assigned per room; trusted envelope fields
-- (classification, policy decision) are written only by the gateway.
create table room_events (
  id                        text primary key,
  room_id                   text not null references rooms(id),
  sequence                  bigint not null,
  sender_participant_id     text references room_participants(id),
  recipient_participant_id  text references room_participants(id),
  type                      text not null,
  created_at                timestamptz not null default now(),
  classification            jsonb not null,
  body                      jsonb not null,
  provenance                jsonb not null,
  policy                    jsonb not null,
  unique (room_id, sequence)
);
create index room_events_room_seq on room_events (room_id, sequence);

create table approvals (
  id                          text primary key,
  room_id                     text not null references rooms(id),
  requested_by_participant_id text not null references room_participants(id),
  candidate_body              jsonb not null,
  event_type                  text not null,
  action                      text,
  parameters_hash             text not null, -- approval binds to exact parameters
  risk                        text not null check (risk in ('LOW','MEDIUM','HIGH')),
  reason                      text not null,
  status                      text not null check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','INVALIDATED')),
  decided_by_user_id          text references users(id),
  decided_at                  timestamptz,
  approver_org_id             text not null references organizations(id),
  expires_at                  timestamptz not null,
  created_at                  timestamptz not null default now(),
  consumed_at                 timestamptz
);

create table evidence (
  id                          text primary key,
  room_id                     text not null references rooms(id),
  criterion_id                text not null,
  submitted_by_participant_id text not null references room_participants(id),
  evidence_type               text not null,
  description                 text not null,
  reference                   text,
  verification                text not null check (verification in ('CLAIMED','ATTESTED','SYSTEM_VERIFIED','HUMAN_VERIFIED')),
  verified_by_user_id         text references users(id),
  created_at                  timestamptz not null default now()
);

create table criterion_statuses (
  room_id      text not null references rooms(id),
  criterion_id text not null,
  state        text not null check (state in ('PENDING','EVIDENCE_SUBMITTED','VERIFIED')),
  primary key (room_id, criterion_id)
);

-- Tamper-evident audit chain: event_hash = sha256(previous_hash || canonical(event)).
create table audit_events (
  id              text primary key,
  sequence        bigint not null unique,
  timestamp       timestamptz not null,
  action          text not null,
  actor_type      text not null check (actor_type in ('user','agent','system')),
  actor_id        text,
  organization_id text,
  room_id         text,
  resource        text,
  policy_version  text,
  decision        text,
  metadata        jsonb not null default '{}',
  previous_hash   text not null,
  event_hash      text not null
);

-- Prevent UPDATE/DELETE at the database layer as well.
create or replace function audit_events_immutable() returns trigger as $$
begin
  raise exception 'audit_events is append-only';
end;
$$ language plpgsql;
create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function audit_events_immutable();

create table audit_checkpoints (
  id             text primary key,
  created_at     timestamptz not null,
  up_to_sequence bigint not null,
  head_hash      text not null,
  key_id         text not null,
  signature      text not null
);

create table security_alerts (
  id              text primary key,
  room_id         text references rooms(id),
  organization_id text references organizations(id),
  severity        text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  kind            text not null,
  detail          text not null,
  created_at      timestamptz not null default now()
);

create table idempotency_records (
  scope         text not null,
  key           text not null,
  response_hash text not null,
  response_body jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (scope, key)
);

create table usage_records (
  id              text primary key,
  room_id         text not null references rooms(id),
  organization_id text not null references organizations(id),
  kind            text not null,   -- turns | tool_calls | model_spend_usd
  amount          numeric not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (defense-in-depth). The application sets
--   set_config('booth.org_ids', '<comma separated org ids>', true)
-- per transaction after verifying the authenticated principal's memberships.
-- ---------------------------------------------------------------------------

create or replace function booth_current_org_ids() returns text[] as $$
  select string_to_array(coalesce(current_setting('booth.org_ids', true), ''), ',');
$$ language sql stable;

alter table rooms enable row level security;
create policy rooms_tenant on rooms using (
  creator_org_id = any (booth_current_org_ids())
  or id in (select room_id from room_participants where organization_id = any (booth_current_org_ids()))
);

alter table room_events enable row level security;
create policy room_events_tenant on room_events using (
  room_id in (select room_id from room_participants where organization_id = any (booth_current_org_ids()))
);

alter table approvals enable row level security;
create policy approvals_tenant on approvals using (
  approver_org_id = any (booth_current_org_ids())
  or room_id in (select room_id from room_participants where organization_id = any (booth_current_org_ids()))
);

alter table agent_connections enable row level security;
create policy agent_connections_tenant on agent_connections using (
  organization_id = any (booth_current_org_ids())
);
