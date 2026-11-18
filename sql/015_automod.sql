-- Tower v1.3.0 : AutoMod
-- Run once in Supabase -> SQL Editor.

create table if not exists public.automod_settings (
  guild_id         text primary key,
  enabled          boolean     not null default false,
  config           jsonb       not null default '{}'::jsonb,   -- per-rule settings; anything missing uses the defaults
  exempt_channels  jsonb       not null default '[]'::jsonb,
  exempt_roles     jsonb       not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

create table if not exists public.automod_words (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  word        text        not null,
  word_key    text        not null,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  unique (guild_id, word_key)
);

alter table public.automod_settings enable row level security;
alter table public.automod_words    enable row level security;
