-- Tower v0.8.0 : /embed builder (saved templates and posted embeds)
-- Run once in Supabase -> SQL Editor.

-- Saved templates, one name per server (names are matched without caring about capitals).
create table if not exists public.embed_templates (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  name        text        not null,
  name_key    text        not null,
  data        jsonb       not null,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (guild_id, name_key)
);

-- Every embed Tower posts, so it can be edited later and so its dropdown menus keep working after a restart.
create table if not exists public.embed_posts (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  channel_id  text        not null,
  message_id  text        not null,
  via         text        not null default 'tower',   -- 'tower' or 'webhook'
  data        jsonb       not null,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (channel_id, message_id)
);
create index if not exists embed_posts_message_idx on public.embed_posts (message_id);
create index if not exists embed_posts_guild_idx   on public.embed_posts (guild_id, created_at desc);

alter table public.embed_templates enable row level security;
alter table public.embed_posts     enable row level security;
