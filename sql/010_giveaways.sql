-- Tower v0.9.0 : giveaways
-- Run once in Supabase -> SQL Editor.

create table if not exists public.giveaways (
  id            bigint generated always as identity primary key,
  guild_id      text        not null,
  channel_id    text        not null,
  message_id    text,
  host_id       text        not null,
  prize         text        not null,
  description   text        not null default '',
  winner_note   text        not null default '',          -- extra line shown in the winner message
  winners       integer     not null default 1,
  ends_at       timestamptz not null,
  status        text        not null default 'active',     -- active | ended | cancelled
  requirements  jsonb       not null default '{}'::jsonb,  -- { minXp, minLevel, roleId, booster, minDays }
  ping_role_id  text,
  claim_hours   integer     not null default 48,
  winner_ids    jsonb       not null default '[]'::jsonb,   -- list of user IDs
  winner_message_id text,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists giveaways_due_idx   on public.giveaways (status, ends_at);
create index if not exists giveaways_guild_idx on public.giveaways (guild_id, created_at desc);
create index if not exists giveaways_message_idx on public.giveaways (message_id);

create table if not exists public.giveaway_entries (
  giveaway_id bigint      not null references public.giveaways(id) on delete cascade,
  user_id     text        not null,
  joined_at   timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);

alter table public.giveaways        enable row level security;
alter table public.giveaway_entries enable row level security;
