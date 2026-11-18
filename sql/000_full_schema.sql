-- Tower: complete database schema (everything in sql/001 to sql/018, in order).
-- Paste this whole file into Supabase -> SQL Editor -> New query, and press Run. It is safe to run again:
-- every statement uses IF NOT EXISTS, so running it twice changes nothing.

-- ======================= 001_verification.sql =======================
-- Tower v0.1.0 : verification schema
-- Run once in Supabase -> SQL Editor.

create table if not exists public.guild_settings (
  guild_id             text primary key,
  verification_enabled boolean     not null default false,
  verify_channel_id    text,
  log_channel_id       text,
  unverified_role_id   text,
  verified_role_id     text,
  panel_channel_id     text,
  panel_message_id     text,
  raid_mode            boolean     not null default false,
  raid_started_at      timestamptz,
  enabled_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One live captcha session per member. Only a keyed hash of the answer is stored.
create table if not exists public.verification_sessions (
  id            uuid primary key default gen_random_uuid(),
  guild_id      text        not null,
  user_id       text        not null,
  code_hash     text        not null,
  tier          smallint    not null,
  attempts_left smallint    not null,
  refreshes     smallint    not null default 0,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint verification_sessions_member_unique unique (guild_id, user_id)
);

-- Strikes and cooldowns survive restarts and rejoins.
create table if not exists public.verification_state (
  guild_id     text        not null,
  user_id      text        not null,
  strikes      smallint    not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- Append-only audit trail. The row id becomes VER-000001 / AUD-000001 in logs.
create table if not exists public.verification_events (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  user_id    text,
  type       text        not null,
  tier       smallint,
  attempts   smallint,
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists verification_events_guild_idx
  on public.verification_events (guild_id, created_at desc);

-- Defense in depth: lock every table against Supabase's public API.
-- The bot connects with the Postgres connection string, which is not affected.
alter table public.guild_settings        enable row level security;
alter table public.verification_sessions enable row level security;
alter table public.verification_state    enable row level security;
alter table public.verification_events   enable row level security;

-- ======================= 002_logging.sql =======================
-- Tower v0.3.0 : logging schema
-- Run once in Supabase -> SQL Editor.

-- Which log types staff switched off with /logs toggle (absent row = enabled).
create table if not exists public.log_settings (
  guild_id   text        not null,
  log_type   text        not null,
  enabled    boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (guild_id, log_type)
);

-- Metadata-only audit trail. Message text is NEVER stored here.
-- The row id becomes LOG-000123 on every log card. Rows older than 30 days are pruned.
create table if not exists public.log_events (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  type       text        not null,
  actor_id   text,
  target_id  text,
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists log_events_guild_idx on public.log_events (guild_id, created_at desc);
create index if not exists log_events_target_idx on public.log_events (guild_id, target_id);

alter table public.log_settings enable row level security;
alter table public.log_events   enable row level security;

-- ======================= 003_log_channels.sql =======================
-- Tower v0.3.1 : optional per-log channel override (set with /logs channel)
-- Run once in Supabase -> SQL Editor.
alter table public.log_settings add column if not exists channel_id text;

-- ======================= 004_moderation.sql =======================
-- Tower v0.4.0 : moderation schema
-- Run once in Supabase -> SQL Editor.

-- Per-server case numbering (Case #0001, #0002, ...), incremented atomically.
create table if not exists public.mod_counters (
  guild_id  text primary key,
  last_case integer not null default 0
);

create table if not exists public.mod_cases (
  id             bigint generated always as identity primary key,
  guild_id       text        not null,
  case_number    integer     not null,
  type           text        not null,   -- warn | note | timeout | untimeout | kick | ban | unban
  user_id        text        not null,
  user_tag       text        not null,
  moderator_id   text        not null,
  moderator_tag  text        not null,
  reason         text        not null default 'No reason given',
  duration_ms    bigint,
  expires_at     timestamptz,
  dm_status      text        not null default 'skipped',  -- sent | failed | skipped
  source         text        not null default 'command',  -- command | discord
  voided         boolean     not null default false,
  voided_by      text,
  voided_reason  text,
  voided_at      timestamptz,
  edited_at      timestamptz,
  created_at     timestamptz not null default now(),
  constraint mod_cases_number_unique unique (guild_id, case_number)
);

create index if not exists mod_cases_user_idx on public.mod_cases (guild_id, user_id, created_at desc);
create index if not exists mod_cases_mod_idx  on public.mod_cases (guild_id, moderator_id, created_at desc);

alter table public.mod_counters enable row level security;
alter table public.mod_cases    enable row level security;

-- ======================= 005_tickets.sql =======================
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

-- ======================= 006_ticket_channels.sql =======================
-- Tower v0.5.1 : a second log channel for services, partnership and application tickets
-- Run once in Supabase -> SQL Editor.
alter table public.ticket_settings add column if not exists admin_logs_channel_id text;

-- ======================= 007_levels.sql =======================
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

-- ======================= 008_content.sql =======================
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

-- ======================= 009_embeds.sql =======================
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

-- ======================= 010_giveaways.sql =======================
-- Tower v0.9.0 : giveaways
-- Run once in Supabase -> SQL Editor.

create table if not exists public.giveaways (
  id            bigint generated always as identity primary key,
  guild_id      text        not null,
  channel_id    text        not null,
  message_id    text,
  host_id       text        not null,
  prize         text        not null,
  description   text        not null default '',
  winner_note   text        not null default '',          -- extra line shown in the winner message
  winners       integer     not null default 1,
  ends_at       timestamptz not null,
  status        text        not null default 'active',     -- active | ended | cancelled
  requirements  jsonb       not null default '{}'::jsonb,  -- { minXp, minLevel, roleId, booster, minDays }
  ping_role_id  text,
  claim_hours   integer     not null default 48,
  winner_ids    jsonb       not null default '[]'::jsonb,   -- list of user IDs
  winner_message_id text,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists giveaways_due_idx   on public.giveaways (status, ends_at);
create index if not exists giveaways_guild_idx on public.giveaways (guild_id, created_at desc);
create index if not exists giveaways_message_idx on public.giveaways (message_id);

create table if not exists public.giveaway_entries (
  giveaway_id bigint      not null references public.giveaways(id) on delete cascade,
  user_id     text        not null,
  joined_at   timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);

alter table public.giveaways        enable row level security;
alter table public.giveaway_entries enable row level security;

-- ======================= 011_ai.sql =======================
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

-- ======================= 012_ai_model.sql =======================
-- Tower v1.0.2 : choose the AI model from Discord with /ai settings model_id
-- Run once in Supabase -> SQL Editor.
alter table public.ai_settings add column if not exists model_id text not null default '';

-- ======================= 013_ai_backup.sql =======================
-- Tower v1.1.0 : backup models for the AI assistant (/ai settings backup_models)
-- Run once in Supabase -> SQL Editor.
alter table public.ai_settings add column if not exists backup_models jsonb not null default '[]'::jsonb;

-- ======================= 014_commissions.sql =======================
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

-- ======================= 015_automod.sql =======================
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

-- ======================= 016_staff.sql =======================
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

-- ======================= 017_partners.sql =======================
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

-- ======================= 018_partner_more.sql =======================
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
