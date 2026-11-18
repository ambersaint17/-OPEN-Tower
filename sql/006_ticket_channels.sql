-- Tower v0.5.1 : a second log channel for services, partnership and application tickets
-- Run once in Supabase -> SQL Editor.
alter table public.ticket_settings add column if not exists admin_logs_channel_id text;
