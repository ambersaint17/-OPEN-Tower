-- Tower v0.1.0 : verification schema
-- Run once in Supabase -> SQL Editor.

create table if not exists public.guild_settings (
  guild_id             text primary key,
  verification_enabled boolean     not null default false,
  verify_channel_id    text,
  log_channel_id       text,
  unverified_role_id   text,
  verified_role_id     text,
  panel_channel_id     text,
  panel_message_id     text,
  raid_mode            boolean     not null default false,
  raid_started_at      timestamptz,
  enabled_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One live captcha session per member. Only a keyed hash of the answer is stored.
create table if not exists public.verification_sessions (
  id            uuid primary key default gen_random_uuid(),
  guild_id      text        not null,
  user_id       text        not null,
  code_hash     text        not null,
  tier          smallint    not null,
  attempts_left smallint    not null,
  refreshes     smallint    not null default 0,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint verification_sessions_member_unique unique (guild_id, user_id)
);

-- Strikes and cooldowns survive restarts and rejoins.
create table if not exists public.verification_state (
  guild_id     text        not null,
  user_id      text        not null,
  strikes      smallint    not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- Append-only audit trail. The row id becomes VER-000001 / AUD-000001 in logs.
create table if not exists public.verification_events (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  user_id    text,
  type       text        not null,
  tier       smallint,
  attempts   smallint,
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists verification_events_guild_idx
  on public.verification_events (guild_id, created_at desc);

-- Defense in depth: lock every table against Supabase's public API.
-- The bot connects with the Postgres connection string, which is not affected.
alter table public.guild_settings        enable row level security;
alter table public.verification_sessions enable row level security;
alter table public.verification_state    enable row level security;
alter table public.verification_events   enable row level security;
