-- Tower v1.6.0 : partner sticky message, reciprocity tracker and blacklist
-- Run once in Supabase -> SQL Editor.

alter table public.partner_settings add column if not exists sticky_enabled  boolean not null default true;
alter table public.partner_settings add column if not exists sticky_channels jsonb   not null default '[]'::jsonb;   -- extra channels that also get the sticky message

alter table public.partners add column if not exists reciprocated             boolean     not null default false;
alter table public.partners add column if not exists reciprocated_at          timestamptz;
alter table public.partners add column if not exists reciprocal_proof         text        not null default '';
alter table public.partners add column if not exists reciprocity_reminded_at  timestamptz;

create table if not exists public.partner_blacklist (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  server_id   text        not null,                -- the other server's ID, so a new invite or a new name cannot get around it
  name        text,
  reason      text        not null default '',
  added_by    text        not null,
  created_at  timestamptz not null default now(),
  unique (guild_id, server_id)
);
alter table public.partner_blacklist enable row level security;

-- Where the bot's sticky message currently is, per channel, so it can be replaced after a restart.
create table if not exists public.partner_sticky (
  guild_id    text not null,
  channel_id  text not null,
  message_id  text not null,
  primary key (guild_id, channel_id)
);
alter table public.partner_sticky enable row level security;
