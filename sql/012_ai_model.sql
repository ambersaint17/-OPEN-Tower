-- Tower v1.0.2 : choose the AI model from Discord with /ai settings model_id
-- Run once in Supabase -> SQL Editor.
alter table public.ai_settings add column if not exists model_id text not null default '';
