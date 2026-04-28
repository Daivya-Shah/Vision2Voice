ALTER TABLE public.live_captions
ADD COLUMN IF NOT EXISTS feed_context_json JSONB;
