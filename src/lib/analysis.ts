import { supabase } from "@/integrations/supabase/client";

/** Normalized 0–1 time range; UI maps to video currentTime / duration. */
export interface PossessionSegment {
  t0: number;
  t1: number;
  event_type: string;
  player_name: string;
  team_name: string;
}

export interface AnalysisResult {
  event_type: string;
  player_name: string;
  team_name: string;
  confidence: number;
  visual_summary: string;
  retrieved_context?: {
    player_stats?: Record<string, unknown>;
    team_stats?: Record<string, unknown>;
  };
  commentary_text: string;
  model_name?: string;
  possession_timeline?: PossessionSegment[];
  segment_commentary_lines?: string[];
}

function parseBackendError(res: Response, body: unknown): Error {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return new Error(d);
    return new Error(JSON.stringify(d));
  }
  if (typeof body === "object" && body !== null && "error" in body) {
    const e = (body as { error: unknown }).error;
    return new Error(typeof e === "string" ? e : JSON.stringify(e));
  }
  return new Error(`Request failed (${res.status})`);
}

/** Direct call to FastAPI (local dev). Set `VITE_BACKEND_URL`. */
async function analyzeDirect(
  clipId: string,
  fileUrl: string,
  action?: "regenerate"
): Promise<AnalysisResult> {
  const base = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "");
  if (!base) throw new Error("VITE_BACKEND_URL is not set");

  const path = action === "regenerate" ? "/regenerate" : "/analyze";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip_id: clipId, file_url: fileUrl }),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Bad response from backend (${res.status})`);
  }

  if (!res.ok) {
    throw parseBackendError(res, data);
  }

  const payload = data as AnalysisResult & { error?: string };
  if (payload?.error) throw new Error(payload.error);

  return payload as AnalysisResult;
}

/** Supabase Edge Function (production / default). */
async function analyzeEdge(
  clipId: string,
  fileUrl: string,
  action?: "regenerate"
): Promise<AnalysisResult> {
  const { data, error: fnError } = await supabase.functions.invoke("process-video", {
    body: { clip_id: clipId, file_url: fileUrl, ...(action ? { action } : {}) },
  });

  if (fnError) throw new Error(fnError.message);

  const payload = data as AnalysisResult & { error?: string };
  if (payload?.error) throw new Error(payload.error);

  return payload as AnalysisResult;
}

/** True when frontend should call Python directly (same machine / LAN). */
export function useDirectBackend(): boolean {
  return Boolean(import.meta.env.VITE_BACKEND_URL?.trim());
}

export async function runAnalysisPipeline(
  clipId: string,
  fileUrl: string,
  action?: "regenerate"
): Promise<AnalysisResult> {
  if (useDirectBackend()) {
    return analyzeDirect(clipId, fileUrl, action);
  }
  return analyzeEdge(clipId, fileUrl, action);
}

/** Base URL for FastAPI (voiceover export, etc.). */
export function getBackendBaseUrl(): string | undefined {
  const b = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/$/, "");
  return b || undefined;
}

/** MP4 with OpenAI TTS voiceover (requires local backend + OPENAI_API_KEY on server). */
export async function exportCommentaryVideo(
  fileUrl: string,
  commentaryText: string,
  opts?: {
    possession_timeline?: PossessionSegment[];
    segment_commentary_lines?: string[];
  }
): Promise<Blob> {
  const base = getBackendBaseUrl();
  if (!base) {
    throw new Error("Set VITE_BACKEND_URL in .env to use voiceover export.");
  }
  const tl = opts?.possession_timeline;
  const sl = opts?.segment_commentary_lines;
  const useTimeline =
    Array.isArray(tl) &&
    Array.isArray(sl) &&
    tl.length > 0 &&
    tl.length === sl.length;
  const res = await fetch(`${base}/export-commentary-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: fileUrl,
      commentary_text: commentaryText,
      ...(useTimeline
        ? { possession_timeline: tl, segment_commentary_lines: sl }
        : {}),
    }),
  });
  if (!res.ok) {
    let msg = await res.text();
    try {
      const j = JSON.parse(msg) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
      else if (j.detail != null) msg = JSON.stringify(j.detail);
    } catch {
      /* use raw text */
    }
    throw new Error(msg || `Voiceover export failed (${res.status})`);
  }
  return res.blob();
}
