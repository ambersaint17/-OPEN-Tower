-- Tower v0.3.1 : optional per-log channel override (set with /logs channel)
-- Run once in Supabase -> SQL Editor.
alter table public.log_settings add column if not exists channel_id text;
