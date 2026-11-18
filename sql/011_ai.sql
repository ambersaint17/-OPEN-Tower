-- Tower v1.0.0 : AI assistant (/ask, /ai)
-- Run once in Supabase -> SQL Editor.

create table if not exists public.ai_settings (
  guild_id           text primary key,
  enabled            boolean     not null default false,
  model              text        not null default 'haiku',         -- 'haiku' (fast, cheap) or 'sonnet' (smarter)
  instructions       text        not null default '',              -- extra tone and rules from the owner
  ticket_types       jsonb       not null default '[]'::jsonb,     -- ticket types where the AI may help, e.g. ["support"]
  user_daily_limit   integer     not null default 20,              -- questions per member per day (staff are exempt)
  daily_token_budget integer     not null default 300000,          -- whole-server cap per day
  updated_at         timestamptz not null default now()
);

create table if not exists public.ai_knowledge (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  title       text        not null,
  title_key   text        not null,
  content     text        not null,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (guild_id, title_key)
);

-- Tokens and questions per member per day (UTC), for the limits.
create table if not exists public.ai_usage (
  guild_id   text    not null,
  day        text    not null,                                      -- YYYY-MM-DD
  user_id    text    not null,
  requests   integer not null default 0,
  tokens     integer not null default 0,
  primary key (guild_id, day, user_id)
);

-- What was asked in /ask and how it went, for staff to review. Ticket conversations are never stored here.
create table if not exists public.ai_log (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  user_id     text        not null,
  channel_id  text        not null,
  kind        text        not null default 'ask',                   -- 'ask' or 'ticket'
  question    text        not null default '',
  answer      text        not null default '',
  tokens      integer     not null default 0,
  rating      smallint,                                             -- 1 helpful, 0 not helpful
  created_at  timestamptz not null default now()
);
create index if not exists ai_log_guild_idx on public.ai_log (guild_id, created_at desc);

alter table public.ai_settings  enable row level security;
alter table public.ai_knowledge enable row level security;
alter table public.ai_usage     enable row level security;
alter table public.ai_log       enable row level security;
