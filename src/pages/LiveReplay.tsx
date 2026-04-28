import { Activity, AlertTriangle, ArrowLeft, Clock3, FileVideo, Radio, Square, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import {
  formatLatency,
  formatReplayTime,
  openLiveEventSource,
  requireBackendBaseUrl,
  startLiveSession,
  stopLiveSession,
  type LiveCaptionEvent,
  type LiveStreamEvent,
} from "@/lib/live";

type SetupMode = "upload" | "url";

const sourceTone: Record<string, string> = {
  feed: "border-primary/30 bg-primary/10 text-primary",
  feed_with_vision: "border-accent/40 bg-accent/10 text-accent",
  feed_context_with_vision: "border-sky-400/40 bg-sky-400/10 text-sky-300",
};

const LiveReplay = () => {
  const [mode, setMode] = useState<SetupMode>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [gameId, setGameId] = useState("");
  const [startPeriod, setStartPeriod] = useState("1");
  const [startClock, setStartClock] = useState("12:00");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [captions, setCaptions] = useState<LiveCaptionEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [liveClock, setLiveClock] = useState("-");
  const [busy, setBusy] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const latestCaption = captions[0];
  const canStart = Boolean(gameId.trim() && startClock.trim() && (mode === "url" ? videoUrl.trim() : videoFile));
  const backendReady = useMemo(() => {
    try {
      requireBackendBaseUrl();
      return true;
    } catch {
      return false;
    }
  }, []);

  const uploadFile = async (file: File): Promise<string> => {
    const fileName = `live-replay/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("videos").upload(fileName, file);
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data } = supabase.storage.from("videos").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleStart = async () => {
    if (!canStart) return;
    setBusy(true);
    setStreamError(null);
    setCaptions([]);
    setWarnings([]);
    setProgress(0);
    setStatus("preparing");

    try {
      const fileUrl = mode === "upload" && videoFile ? await uploadFile(videoFile) : videoUrl.trim();
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(mode === "upload" && videoFile ? URL.createObjectURL(videoFile) : fileUrl);

      const session = await startLiveSession({
        file_url: fileUrl,
        nba_game_id: gameId.trim(),
        start_period: Number(startPeriod) || 1,
        start_clock: startClock.trim(),
        cadence_sec: 3,
        window_sec: 6,
      });

      setSessionId(session.session_id);
      setStatus(session.status);
      setWarnings(session.warnings || []);
      setTeams(session.team_names || []);
      setEventCount(session.event_count || 0);
      eventSourceRef.current?.close();
      eventSourceRef.current = openLiveEventSource(session.session_id, handleStreamEvent, setStreamError);
      toast.success("Live replay session started");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start live replay";
      setStreamError(message);
      setStatus("error");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleStreamEvent = (event: LiveStreamEvent) => {
    if (event.type === "caption") {
      setCaptions((current) => [event, ...current].slice(0, 40));
      setStatus("running");
      return;
    }
    if (event.type === "tick") {
      setLiveClock(`Q${event.period} ${event.clock}`);
      setProgress(event.duration_sec ? Math.min(100, (event.replay_time_sec / event.duration_sec) * 100) : 0);
      return;
    }
    if (event.type === "session_ready") {
      setTeams(Array.isArray(event.team_names) ? event.team_names : []);
      setWarnings(Array.isArray(event.warnings) ? event.warnings : []);
      setStatus(String(event.status || "ready"));
      return;
    }
    if (event.type === "status" || event.type === "complete" || event.type === "stopped") {
      setStatus(String(event.status || event.type));
      if (event.type === "complete" || event.type === "stopped") eventSourceRef.current?.close();
      return;
    }
    if (event.type === "error") {
      setStatus("error");
      setStreamError(String(event.error || "Live replay failed"));
      eventSourceRef.current?.close();
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    await stopLiveSession(sessionId);
    eventSourceRef.current?.close();
    setStatus("stopping");
  };

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/" className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Offline clip analysis
            </Link>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Live Replay <span className="text-primary">Desk</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Simulated-live NBA captions using play-by-play truth, rolling visual context, and a pregame knowledge packet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              <Radio className="mr-1 h-3 w-3" />
              {status}
            </Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">
              {eventCount} feed events
            </Badge>
          </div>
        </header>

        {!backendReady && (
          <Alert className="mb-5 border-accent/40 bg-accent/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Backend required</AlertTitle>
            <AlertDescription>
              Live Replay needs <code>VITE_BACKEND_URL</code> and the Python API. Run <code>npm run dev:full</code>.
            </AlertDescription>
          </Alert>
        )}

        <main className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <section className="space-y-5">
            <div className="glass-card rounded-xl p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">Session Setup</h2>
                <Activity className="h-5 w-5 text-primary" />
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-secondary/40 p-1">
                <button
                  type="button"
                  onClick={() => setMode("upload")}
                  className={`rounded-md px-3 py-2 text-sm transition ${mode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => setMode("url")}
                  className={`rounded-md px-3 py-2 text-sm transition ${mode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  URL
                </button>
              </div>

              {mode === "upload" ? (
                <label className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-8 text-center hover:border-primary/60">
                  <UploadCloud className="mb-3 h-8 w-8 text-primary" />
                  <span className="font-display text-lg font-semibold">{videoFile ? videoFile.name : "Choose replay video"}</span>
                  <span className="mt-1 text-xs text-muted-foreground">Uploaded to Supabase Storage before the live session starts</span>
                  <input
                    type="file"
                    accept="video/mp4,video/*"
                    className="hidden"
                    onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                  />
                </label>
              ) : (
                <div className="mb-4 space-y-2">
                  <Label htmlFor="video-url">Replay video URL</Label>
                  <Input
                    id="video-url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://..."
                    className="bg-secondary/30"
                  />
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="game-id">NBA game id</Label>
                  <Input
                    id="game-id"
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    placeholder="0022500001"
                    className="bg-secondary/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="period">Start period</Label>
                    <Input
                      id="period"
                      value={startPeriod}
                      onChange={(e) => setStartPeriod(e.target.value)}
                      inputMode="numeric"
                      className="bg-secondary/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clock">Start clock</Label>
                    <Input
                      id="clock"
                      value={startClock}
                      onChange={(e) => setStartClock(e.target.value)}
                      placeholder="12:00"
                      className="bg-secondary/30"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <Button disabled={!canStart || busy || !backendReady} onClick={handleStart} className="flex-1">
                  <Radio className="mr-2 h-4 w-4" />
                  {busy ? "Starting..." : "Start replay"}
                </Button>
                <Button disabled={!sessionId || status !== "running"} onClick={handleStop} variant="outline">
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              </div>
            </div>

            <div className="glass-card rounded-xl p-5">
              <h2 className="mb-4 font-display text-xl font-semibold">Runtime</h2>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Replay progress</span>
                    <span className="font-medium">{progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
                <Metric label="Game clock" value={liveClock} />
                <Metric label="Latest latency" value={formatLatency(latestCaption?.latency_ms)} />
                <Metric label="Latest source" value={latestCaption?.source || "-"} />
                {teams.length > 0 && <Metric label="Teams" value={teams.join(" / ")} />}
              </div>
            </div>

            {(warnings.length > 0 || streamError) && (
              <Alert variant={streamError ? "destructive" : "default"} className="border-border bg-card">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{streamError ? "Live stream issue" : "Provider warnings"}</AlertTitle>
                <AlertDescription>
                  {streamError || warnings.slice(0, 2).join(" ")}
                </AlertDescription>
              </Alert>
            )}
          </section>

          <section className="space-y-5">
            <div className="glass-card overflow-hidden rounded-xl">
              {previewUrl ? (
                <video src={previewUrl} controls playsInline className="w-full bg-black" style={{ maxHeight: 460 }} />
              ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
                  <FileVideo className="h-12 w-12" />
                  <p className="text-sm">Replay video appears here after session start.</p>
                </div>
              )}
            </div>

            <div className="glass-card rounded-xl p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">Caption Feed</h2>
                <Badge variant="outline" className="border-border text-muted-foreground">
                  3s cadence / 6s window
                </Badge>
              </div>

              {captions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  Captions will stream here as replay time aligns with play-by-play events.
                </div>
              ) : (
                <div className="space-y-3">
                  {captions.map((caption) => (
                    <article key={caption.event_id} className="rounded-lg border border-border bg-secondary/20 p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={sourceTone[caption.source] || "border-border"}>
                          {caption.source}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="h-3 w-3" />
                          Q{caption.period} {caption.clock} · replay {formatReplayTime(caption.replay_time_sec)}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatLatency(caption.latency_ms)}</span>
                      </div>
                      <p className="text-base leading-relaxed text-foreground">{caption.text}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {caption.player_name || caption.team_name || caption.event_type}
                        {caption.score ? ` · ${caption.score}` : ""}
                      </p>
                      {caption.feed_context && (
                        <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                          {formatFeedContext(caption)}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2 text-sm last:border-0 last:pb-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium text-foreground">{value}</span>
  </div>
);

const formatFeedContext = (caption: LiveCaptionEvent): string => {
  const context = caption.feed_context;
  if (!context) return "";
  const pieces: string[] = [];
  if (context.teams?.length) pieces.push(context.teams.join(" / "));
  if (context.last_score) pieces.push(`score ${context.last_score}`);
  if (context.nearest_prior_event?.description) pieces.push(`prev: ${context.nearest_prior_event.description}`);
  if (context.nearest_next_event?.description) pieces.push(`next: ${context.nearest_next_event.description}`);
  return pieces.join(" · ");
};

export default LiveReplay;
