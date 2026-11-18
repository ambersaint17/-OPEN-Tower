-- Tower v1.1.0 : backup models for the AI assistant (/ai settings backup_models)
-- Run once in Supabase -> SQL Editor.
alter table public.ai_settings add column if not exists backup_models jsonb not null default '[]'::jsonb;
