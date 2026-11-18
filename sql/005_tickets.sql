-- Tower v0.5.0 : tickets schema
-- Run once in Supabase -> SQL Editor.

create table if not exists public.ticket_settings (
  guild_id            text primary key,
  panel_channel_id    text,
  panel_message_id    text,
  category_id         text,
  handling_channel_id text,
  logs_channel_id     text,
  reviews_channel_id  text,
  updated_at          timestamptz not null default now()
);

create table if not exists public.ticket_counters (
  guild_id    text primary key,
  last_ticket integer not null default 0
);

create table if not exists public.tickets (
  id                   bigint generated always as identity primary key,
  guild_id             text        not null,
  ticket_number        integer     not null,
  type                 text        not null,
  channel_id           text        unique,
  opener_id            text        not null,
  opener_tag           text        not null,
  subject              text        not null,
  -- The intake form, kept only while the ticket exists. It is wiped when the channel is deleted.
  form                 jsonb       not null default '{}'::jsonb,
  status               text        not null default 'open',   -- open | closed | deleted
  claimed_by           text,
  claimed_at           timestamptz,
  first_response_by    text,
  first_response_at    timestamptz,
  last_opener_message_at timestamptz not null default now(),
  last_staff_message_at  timestamptz,
  inactive_hint_sent   boolean     not null default false,
  auto_close_at        timestamptz,
  auto_close_by        text,
  closed_by            text,
  closed_at            timestamptz,
  close_reason         text,
  delete_at            timestamptz,
  opening_message_id   text,
  handling_message_id  text,
  created_at           timestamptz not null default now(),
  constraint tickets_number_unique unique (guild_id, ticket_number)
);

create index if not exists tickets_status_idx on public.tickets (guild_id, status);
create index if not exists tickets_opener_idx on public.tickets (guild_id, opener_id, created_at desc);

create table if not exists public.ticket_blocks (
  guild_id   text        not null,
  user_id    text        not null,
  reason     text        not null default 'No reason given',
  blocked_by text        not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- One rating per ticket. Written feedback is posted to the reviews channel and not stored here.
create table if not exists public.ticket_reviews (
  ticket_id         bigint primary key references public.tickets(id) on delete cascade,
  guild_id          text        not null,
  opener_id         text        not null,
  rating            smallint    not null check (rating between 1 and 5),
  review_message_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.ticket_settings enable row level security;
alter table public.ticket_counters enable row level security;
alter table public.tickets         enable row level security;
alter table public.ticket_blocks   enable row level security;
alter table public.ticket_reviews  enable row level security;
