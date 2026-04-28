-- Live replay sessions for low-latency commentary review.
CREATE TABLE public.live_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_url TEXT NOT NULL,
  nba_game_id TEXT NOT NULL,
  start_period INTEGER NOT NULL,
  start_clock TEXT NOT NULL,
  cadence_sec NUMERIC NOT NULL DEFAULT 3,
  window_sec NUMERIC NOT NULL DEFAULT 6,
  status TEXT NOT NULL DEFAULT 'created',
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.live_captions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  event_id TEXT,
  period INTEGER,
  game_clock TEXT,
  event_type TEXT,
  player_name TEXT,
  team_name TEXT,
  score TEXT,
  caption_text TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence NUMERIC,
  latency_ms INTEGER,
  model_name TEXT,
  feed_description TEXT,
  visual_summary TEXT,
  feed_context_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_captions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read live_sessions" ON public.live_sessions FOR SELECT USING (true);
CREATE POLICY "Public insert live_sessions" ON public.live_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update live_sessions" ON public.live_sessions FOR UPDATE USING (true);

CREATE POLICY "Public read live_captions" ON public.live_captions FOR SELECT USING (true);
CREATE POLICY "Public insert live_captions" ON public.live_captions FOR INSERT WITH CHECK (true);
