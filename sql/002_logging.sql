-- Tower v0.3.0 : logging schema
-- Run once in Supabase -> SQL Editor.

-- Which log types staff switched off with /logs toggle (absent row = enabled).
create table if not exists public.log_settings (
  guild_id   text        not null,
  log_type   text        not null,
  enabled    boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (guild_id, log_type)
);

-- Metadata-only audit trail. Message text is NEVER stored here.
-- The row id becomes LOG-000123 on every log card. Rows older than 30 days are pruned.
create table if not exists public.log_events (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  type       text        not null,
  actor_id   text,
  target_id  text,
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists log_events_guild_idx on public.log_events (guild_id, created_at desc);
create index if not exists log_events_target_idx on public.log_events (guild_id, target_id);

alter table public.log_settings enable row level security;
alter table public.log_events   enable row level security;
