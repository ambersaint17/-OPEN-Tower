-- Tower v0.4.0 : moderation schema
-- Run once in Supabase -> SQL Editor.

-- Per-server case numbering (Case #0001, #0002, ...), incremented atomically.
create table if not exists public.mod_counters (
  guild_id  text primary key,
  last_case integer not null default 0
);

create table if not exists public.mod_cases (
  id             bigint generated always as identity primary key,
  guild_id       text        not null,
  case_number    integer     not null,
  type           text        not null,   -- warn | note | timeout | untimeout | kick | ban | unban
  user_id        text        not null,
  user_tag       text        not null,
  moderator_id   text        not null,
  moderator_tag  text        not null,
  reason         text        not null default 'No reason given',
  duration_ms    bigint,
  expires_at     timestamptz,
  dm_status      text        not null default 'skipped',  -- sent | failed | skipped
  source         text        not null default 'command',  -- command | discord
  voided         boolean     not null default false,
  voided_by      text,
  voided_reason  text,
  voided_at      timestamptz,
  edited_at      timestamptz,
  created_at     timestamptz not null default now(),
  constraint mod_cases_number_unique unique (guild_id, case_number)
);

create index if not exists mod_cases_user_idx on public.mod_cases (guild_id, user_id, created_at desc);
create index if not exists mod_cases_mod_idx  on public.mod_cases (guild_id, moderator_id, created_at desc);

alter table public.mod_counters enable row level security;
alter table public.mod_cases    enable row level security;
