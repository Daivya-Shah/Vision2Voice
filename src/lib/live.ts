import { getBackendBaseUrl } from "@/lib/analysis";

export interface LiveSessionRequest {
  file_url: string;
  nba_game_id: string;
  start_period: number;
  start_clock: string;
  cadence_sec?: number;
  window_sec?: number;
  replay_speed?: number;
  clock_mode?: "replay_media" | string;
}

export interface LiveSessionResponse {
  session_id: string;
  status: string;
  team_names: string[];
  event_count: number;
  warnings: string[];
}

export interface LiveUploadResponse {
  upload_id: string;
  file_url: string;
  filename: string;
  size_bytes: number;
}

export interface LiveTeamOption {
  team_id: string;
  name: string;
  abbreviation?: string | null;
  city?: string | null;
}

export interface LiveGameSearchResult {
  game_id: string;
  game_date: string;
  season: string;
  season_type: string;
  matchup: string;
  team_abbreviation: string;
  opponent_abbreviation: string;
  home_team?: string | null;
  away_team?: string | null;
  team_score?: number | null;
  opponent_score?: number | null;
  score?: string | null;
  result?: string | null;
}

export interface LiveCaptionEvent {
  type: "caption";
  session_id: string;
  event_id: string;
  period: number;
  clock: string;
  event_type: string;
  player_name?: string | null;
  team_name?: string | null;
  score?: string | null;
  text: string;
  source: string;
  confidence: number;
  model_name: string;
  replay_time_sec: number;
  feed_description?: string | null;
  visual_summary?: string | null;
  feed_context?: {
    period?: number;
    clock?: string;
    teams?: string[];
    last_score?: string | null;
    nearest_prior_event?: {
      event_id?: string;
      clock?: string;
      description?: string;
      team_name?: string | null;
    } | null;
  } | null;
  latency_ms: number;
}

export interface LiveTickEvent {
  type: "tick";
  session_id: string;
  replay_time_sec: number;
  duration_sec: number;
  period: number;
  clock: string;
  playback_rate?: number;
  clock_mode?: string;
}

export interface LivePlaybackControlRequest {
  state: "playing" | "paused";
  replay_time_sec: number;
  playback_rate: number;
}

export type LiveStreamEvent =
  | LiveCaptionEvent
  | LiveTickEvent
  | {
      type:
        | "connected"
        | "session_ready"
        | "status"
        | "complete"
        | "stopped"
        | "error"
        | "ping";
      session_id?: string;
      status?: string;
      error?: string;
      team_names?: string[];
      warnings?: string[];
      replay_time_sec?: number;
      duration_sec?: number | null;
      playback_rate?: number;
      clock_mode?: string;
      [key: string]: unknown;
    };

export function requireBackendBaseUrl(): string {
  const base = getBackendBaseUrl();
  if (!base) {
    throw new Error("Set VITE_BACKEND_URL and run npm run dev:full to use Live Replay.");
  }
  return base;
}

export async function startLiveSession(body: LiveSessionRequest): Promise<LiveSessionResponse> {
  const base = requireBackendBaseUrl();
  const res = await fetch(`${base}/live/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Live session failed (${res.status})`;
    throw new Error(detail);
  }
  return data as LiveSessionResponse;
}

export async function fetchLiveTeams(): Promise<LiveTeamOption[]> {
  const base = requireBackendBaseUrl();
  const res = await fetch(`${base}/live/teams`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Team lookup failed (${res.status})`;
    throw new Error(detail);
  }
  return data as LiveTeamOption[];
}

export async function uploadLiveReplayFile(file: File): Promise<LiveUploadResponse> {
  const base = requireBackendBaseUrl();
  const qs = new URLSearchParams({ filename: file.name || "replay.mp4" });
  const res = await fetch(`${base}/live/uploads?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Replay upload failed (${res.status})`;
    throw new Error(detail);
  }
  return data as LiveUploadResponse;
}

export async function searchLiveGames(params: {
  team: string;
  opponent: string;
  season: string;
  season_type: string;
  limit?: number;
}): Promise<LiveGameSearchResult[]> {
  const base = requireBackendBaseUrl();
  const qs = new URLSearchParams({
    team: params.team,
    opponent: params.opponent,
    season: params.season,
    season_type: params.season_type,
    limit: String(params.limit ?? 20),
  });
  const res = await fetch(`${base}/live/games/search?${qs.toString()}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Game search failed (${res.status})`;
    throw new Error(detail);
  }
  return data as LiveGameSearchResult[];
}

export async function stopLiveSession(sessionId: string): Promise<void> {
  const base = requireBackendBaseUrl();
  await fetch(`${base}/live/sessions/${sessionId}/stop`, { method: "POST" });
}

export async function updateLivePlayback(
  sessionId: string,
  body: LivePlaybackControlRequest,
): Promise<void> {
  const base = requireBackendBaseUrl();
  const res = await fetch(`${base}/live/sessions/${sessionId}/playback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = data && typeof data.detail === "string" ? data.detail : `Playback control failed (${res.status})`;
    throw new Error(detail);
  }
}

export function openLiveEventSource(
  sessionId: string,
  onEvent: (event: LiveStreamEvent) => void,
  onError: (message: string) => void,
): EventSource {
  const base = requireBackendBaseUrl();
  const source = new EventSource(`${base}/live/sessions/${sessionId}/events`);
  const eventTypes = ["connected", "session_ready", "status", "caption", "tick", "complete", "stopped", "error", "ping"];
  for (const type of eventTypes) {
    source.addEventListener(type, (message) => {
      try {
        onEvent(JSON.parse((message as MessageEvent).data) as LiveStreamEvent);
      } catch {
        onError("Received an unreadable live event.");
      }
    });
  }
  source.onerror = () => {
    onError("Live event stream disconnected.");
  };
  return source;
}

export function formatLatency(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatReplayTime(seconds?: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
