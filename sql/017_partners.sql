-- Tower v1.5.0 : partnerships (/partner, /partners)
-- Run once in Supabase -> SQL Editor.

create table if not exists public.partner_settings (
  guild_id         text primary key,
  channel_id       text,                                   -- where partner ads are posted
  min_members      integer     not null default 0,         -- servers smaller than this are flagged (0 = no minimum)
  partner_role_id  text,                                   -- optional role given to a partner's representative
  our_ad           text        not null default '',        -- our own ad, to hand to partners
  updated_at       timestamptz not null default now()
);

create table if not exists public.partners (
  id                 bigint generated always as identity primary key,
  guild_id           text        not null,
  server_name        text        not null,
  invite_code        text        not null,
  invite_guild_id    text,
  member_count       integer,
  rep_user_id        text,                                 -- the partner's representative in our server
  posted_by          text        not null,
  ad_text            text        not null,
  ping               text        not null default 'none',  -- none | here | everyone | role:<id>
  channel_id         text,
  message_id         text,
  ticket_channel_id  text,
  status             text        not null default 'active', -- active | ended
  end_reason         text        not null default '',
  created_at         timestamptz not null default now(),
  ended_at           timestamptz
);
create index if not exists partners_guild_idx on public.partners (guild_id, status, created_at desc);
create index if not exists partners_invite_idx on public.partners (guild_id, invite_guild_id);

alter table public.partner_settings enable row level security;
alter table public.partners         enable row level security;
