
-- Create clips table
CREATE TABLE public.clips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  file_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create detections table
CREATE TABLE public.detections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  event_type TEXT,
  player_name TEXT,
  team_name TEXT,
  confidence NUMERIC,
  visual_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create retrieved_context table
CREATE TABLE public.retrieved_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  player_stats_json JSONB,
  team_stats_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create commentaries table
CREATE TABLE public.commentaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  model_name TEXT,
  commentary_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create evaluations table
CREATE TABLE public.evaluations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  fluency_score INTEGER,
  factual_score INTEGER,
  style_score INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retrieved_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commentaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth - tool-like app)
CREATE POLICY "Public read clips" ON public.clips FOR SELECT USING (true);
CREATE POLICY "Public insert clips" ON public.clips FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read detections" ON public.detections FOR SELECT USING (true);
CREATE POLICY "Public insert detections" ON public.detections FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read retrieved_context" ON public.retrieved_context FOR SELECT USING (true);
CREATE POLICY "Public insert retrieved_context" ON public.retrieved_context FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read commentaries" ON public.commentaries FOR SELECT USING (true);
CREATE POLICY "Public insert commentaries" ON public.commentaries FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update commentaries" ON public.commentaries FOR UPDATE USING (true);
CREATE POLICY "Public read evaluations" ON public.evaluations FOR SELECT USING (true);
CREATE POLICY "Public insert evaluations" ON public.evaluations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update evaluations" ON public.evaluations FOR UPDATE USING (true);

-- Create videos storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', true);

-- Storage policies
CREATE POLICY "Public read videos" ON storage.objects FOR SELECT USING (bucket_id = 'videos');
CREATE POLICY "Public upload videos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'videos');
