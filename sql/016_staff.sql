-- Tower v1.4.0 : staff management (/induct, /promote, /demote, /remove, /roster, /offers)
-- Run once in Supabase -> SQL Editor.

-- Induction offers sent to people by DM, waiting for their answer.
create table if not exists public.staff_offers (
  id               bigint generated always as identity primary key,
  guild_id         text        not null,
  user_id          text        not null,
  team             text        not null,
  rank_key         text        not null,
  offered_by       text        not null,
  note             text        not null default '',            -- the message from whoever made the offer
  status           text        not null default 'pending',     -- pending | accepted | declined | expired | cancelled | failed
  response_note    text        not null default '',            -- what the person wrote when answering
  dm_channel_id    text,
  dm_message_id    text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  responded_at     timestamptz
);
create index if not exists staff_offers_pending_idx on public.staff_offers (guild_id, status, expires_at);
create index if not exists staff_offers_user_idx    on public.staff_offers (guild_id, user_id, status);

-- Every induction, promotion, demotion and removal, for the record and for "since" dates in /roster.
create table if not exists public.staff_history (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  user_id     text        not null,
  action      text        not null,                            -- induct | promote | demote | remove
  team        text        not null,
  from_rank   text,
  to_rank     text,
  by_user     text        not null,
  reason      text        not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists staff_history_user_idx on public.staff_history (guild_id, user_id, created_at desc);

alter table public.staff_offers  enable row level security;
alter table public.staff_history enable row level security;
