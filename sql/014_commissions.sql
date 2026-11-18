-- Tower v1.2.0 : commission manager and client reviews
-- Run once in Supabase -> SQL Editor.

create table if not exists public.commissions (
  id                 bigint generated always as identity primary key,
  guild_id           text        not null,
  client_id          text        not null,
  title              text        not null,
  description        text        not null default '',
  price              text        not null default '',              -- free text, e.g. "$50" or "5,000 Robux"
  status             text        not null default 'quoted',
  deadline           timestamptz,
  paid               boolean     not null default false,
  paid_at            timestamptz,
  ticket_channel_id  text,                                          -- the services ticket this belongs to, if any
  created_by         text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  closed_at          timestamptz,
  last_reminded_at   timestamptz,
  review_requested_at timestamptz,
  notes              jsonb       not null default '[]'::jsonb,      -- private notes: [{ at, by, text }]
  history            jsonb       not null default '[]'::jsonb       -- status changes: [{ at, by, status, note }]
);
create index if not exists commissions_guild_idx  on public.commissions (guild_id, status);
create index if not exists commissions_client_idx on public.commissions (guild_id, client_id);
create index if not exists commissions_due_idx    on public.commissions (deadline) where closed_at is null;

-- One review per commission, kept for the owner's records.
create table if not exists public.commission_reviews (
  id             bigint generated always as identity primary key,
  commission_id  bigint      not null unique references public.commissions(id) on delete cascade,
  guild_id       text        not null,
  client_id      text        not null,
  order_text     text        not null,
  rating         smallint    not null check (rating between 1 and 5),
  went_well      text        not null default '',
  improve        text        not null default '',
  posted_message_id text,
  created_at     timestamptz not null default now()
);
create index if not exists commission_reviews_guild_idx on public.commission_reviews (guild_id, created_at desc);

alter table public.commissions        enable row level security;
alter table public.commission_reviews enable row level security;
