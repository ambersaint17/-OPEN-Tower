-- Tower v0.7.0 : YouTube feed, question of the day, level-up DMs
-- Run once in Supabase -> SQL Editor.

-- Members can switch off level-up DMs with the button on the message.
alter table public.member_xp add column if not exists dm_levelups boolean not null default true;

-- ---------- YouTube ----------
create table if not exists public.youtube_settings (
  guild_id           text primary key,
  youtube_channel_id text,
  channel_url        text,
  post_channel_id    text,
  ping_role_id       text,
  insider_channel_id text,
  style              text    not null default 'classic',   -- classic (real video player) | card
  post_shorts        boolean not null default true,
  primed             boolean not null default false,       -- existing videos are recorded silently once
  last_checked_at    timestamptz,
  last_error         text,
  updated_at         timestamptz not null default now()
);

create table if not exists public.youtube_seen (
  guild_id text        not null,
  video_id text        not null,
  seen_at  timestamptz not null default now(),
  posted   boolean     not null default false,
  primary key (guild_id, video_id)
);

-- ---------- Question of the day ----------
create table if not exists public.qotd_settings (
  guild_id         text primary key,
  channel_id       text,
  alert_channel_id text,
  ping_role_id     text,
  post_hour        smallint not null default 18,
  post_minute      smallint not null default 0,
  utc_offset_min   integer  not null default 0,
  last_post_day    text,
  last_thread_id   text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.qotd_questions (
  id           bigint generated always as identity primary key,
  guild_id     text        not null,
  question     text        not null,
  kind         text        not null default 'open',   -- open | choice
  option_a     text,
  option_b     text,
  added_by     text        not null,
  suggested_by text,
  status       text        not null default 'queued', -- queued | posted
  number       integer,
  message_id   text,
  thread_id    text,
  posted_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists qotd_questions_queue_idx on public.qotd_questions (guild_id, status, id);

create table if not exists public.qotd_suggestions (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  user_id    text        not null,
  question   text        not null,
  status     text        not null default 'pending',  -- pending | approved | rejected
  decided_by text,
  message_id text,
  created_at timestamptz not null default now()
);

alter table public.youtube_settings  enable row level security;
alter table public.youtube_seen      enable row level security;
alter table public.qotd_settings     enable row level security;
alter table public.qotd_questions    enable row level security;
alter table public.qotd_suggestions  enable row level security;
