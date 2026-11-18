-- Tower v0.6.0 : levels schema
-- Run once in Supabase -> SQL Editor.

create table if not exists public.level_settings (
  guild_id         text primary key,
  panel_channel_id text,
  panel_message_id text,
  updated_at       timestamptz not null default now()
);

-- One row per member who has chatted. Deleted the moment they leave the server.
create table if not exists public.member_xp (
  guild_id       text        not null,
  user_id        text        not null,
  xp             bigint      not null default 0,
  streak         integer     not null default 0,
  last_day       date,
  shield_used_at timestamptz,
  colour_role_id text,
  updated_at     timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- Staff configuration: channels, categories and roles to ignore or allow, and XP multipliers.
create table if not exists public.xp_rules (
  guild_id   text         not null,
  kind       text         not null,   -- channel (also categories and forums) | role
  target_id  text         not null,
  mode       text         not null,   -- ignore | allow | multiplier
  multiplier numeric(4,2),
  primary key (guild_id, kind, target_id, mode)
);

-- Double XP weekends and other timed boosts.
create table if not exists public.xp_events (
  id         bigint generated always as identity primary key,
  guild_id   text         not null,
  multiplier numeric(4,2) not null,
  ends_at    timestamptz  not null,
  started_by text         not null,
  created_at timestamptz  not null default now()
);
create index if not exists xp_events_guild_idx on public.xp_events (guild_id, ends_at desc);

-- A booster's personal colour role, removed when the boost ends.
create table if not exists public.booster_roles (
  guild_id text not null,
  user_id  text not null,
  role_id  text not null,
  primary key (guild_id, user_id)
);

alter table public.level_settings enable row level security;
alter table public.member_xp      enable row level security;
alter table public.xp_rules       enable row level security;
alter table public.xp_events      enable row level security;
alter table public.booster_roles  enable row level security;
