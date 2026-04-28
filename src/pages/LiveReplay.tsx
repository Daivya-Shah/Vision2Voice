import { AlertTriangle, Eraser, FileVideo, Radio, RotateCcw, Search, Square, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Marker, Masthead, Rule, Stage } from "@/components/almanac";
import { usePersistentState } from "@/hooks/usePersistentState";
import { cn } from "@/lib/utils";
import {
  formatLatency,
  formatReplayTime,
  fetchLiveTeams,
  openLiveEventSource,
  requireBackendBaseUrl,
  searchLiveGames,
  startLiveSession,
  stopLiveSession,
  updateLivePlayback,
  type LiveCaptionEvent,
  type LiveGameSearchResult,
  type LiveStreamEvent,
  type LiveTeamOption,
  uploadLiveReplayFile,
} from "@/lib/live";

type SetupMode = "upload" | "url";

const sourceLabel: Record<string, string> = {
  feed: "FEED",
  feed_with_vision: "FEED+VISION",
  feed_context_with_vision: "CTX+VISION",
};

const LiveReplay = () => {
  const [mode, setMode] = usePersistentState<SetupMode>("vision2voice.live.mode.v1", "upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = usePersistentState("vision2voice.live.videoUrl.v1", "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [gameId, setGameId] = usePersistentState("vision2voice.live.gameId.v1", "");
  const [teamQuery, setTeamQuery] = usePersistentState("vision2voice.live.teamQuery.v1", "");
  const [opponentQuery, setOpponentQuery] = usePersistentState("vision2voice.live.opponentQuery.v1", "");
  const [seasonQuery, setSeasonQuery] = usePersistentState("vision2voice.live.seasonQuery.v1", defaultNbaSeason());
  const [seasonType, setSeasonType] = usePersistentState<"Regular Season" | "Playoffs">(
    "vision2voice.live.seasonType.v1",
    "Regular Season",
  );
  const [teamOptions, setTeamOptions] = useState<LiveTeamOption[]>([]);
  const [gameResults, setGameResults] = usePersistentState<LiveGameSearchResult[]>(
    "vision2voice.live.gameResults.v1",
    [],
  );
  const [selectedGame, setSelectedGame, clearSelectedGame] = usePersistentState<LiveGameSearchResult | null>(
    "vision2voice.live.selectedGame.v1",
    null,
  );
  const [searchingGames, setSearchingGames] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [startPeriod, setStartPeriod] = usePersistentState("vision2voice.live.startPeriod.v1", "1");
  const [startClock, setStartClock] = usePersistentState("vision2voice.live.startClock.v1", "12:00");
  const [sessionId, setSessionId, clearSessionId] = usePersistentState<string | null>(
    "vision2voice.live.sessionId.v1",
    null,
  );
  const [status, setStatus] = usePersistentState("vision2voice.live.status.v1", "idle");
  const [captions, setCaptions, clearCaptions] = usePersistentState<LiveCaptionEvent[]>(
    "vision2voice.live.captions.v1",
    [],
  );
  const [warnings, setWarnings] = usePersistentState<string[]>("vision2voice.live.warnings.v1", []);
  const [teams, setTeams] = usePersistentState<string[]>("vision2voice.live.teams.v1", []);
  const [eventCount, setEventCount] = usePersistentState("vision2voice.live.eventCount.v1", 0);
  const [progress, setProgress] = usePersistentState("vision2voice.live.progress.v1", 0);
  const [liveClock, setLiveClock] = usePersistentState("vision2voice.live.clock.v1", "—");
  const [busy, setBusy] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const canStart = Boolean(gameId.trim() && startClock.trim() && (mode === "url" ? videoUrl.trim() : videoFile));
  const backendReady = useMemo(() => {
    try {
      requireBackendBaseUrl();
      return true;
    } catch {
      return false;
    }
  }, []);

  const isRunning = status === "running";
  const inBroadcast = Boolean(sessionId) || captions.length > 0 || !!previewUrl;
  const visibleCaptions = inBroadcast
    ? captions.filter((caption) => caption.replay_time_sec <= videoCurrentTime + 0.75)
    : captions;
  const latestCaption = visibleCaptions[0];

  useEffect(() => {
    if (!backendReady) return;
    let cancelled = false;
    fetchLiveTeams()
      .then((teams) => {
        if (!cancelled) setTeamOptions(teams);
      })
      .catch(() => {
        if (!cancelled) setTeamOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [backendReady]);

  const uploadFile = async (file: File): Promise<string> => {
    if (backendReady) {
      try {
        const upload = await uploadLiveReplayFile(file);
        return upload.file_url;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Local replay upload failed");
      }
    }
    const fileName = `live-replay/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("videos").upload(fileName, file);
    if (error) {
      throw new Error(
        `Upload failed: ${error.message}. Use URL mode or run the local backend so large replay files bypass Supabase Storage limits.`,
      );
    }
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
      setVideoCurrentTime(0);

      const session = await startLiveSession({
        file_url: fileUrl,
        nba_game_id: gameId.trim(),
        start_period: Number(startPeriod) || 1,
        start_clock: startClock.trim(),
        cadence_sec: 3,
        window_sec: 6,
        clock_mode: "replay_media",
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

  const handleGameSearch = async () => {
    if (!teamQuery.trim() || !opponentQuery.trim() || !seasonQuery.trim()) {
      setSearchError("ENTER TWO TEAMS AND AN NBA SEASON.");
      return;
    }
    setSearchingGames(true);
    setSearchError(null);
    setGameResults([]);
    try {
      const results = await searchLiveGames({
        team: teamQuery.trim(),
        opponent: opponentQuery.trim(),
        season: seasonQuery.trim(),
        season_type: seasonType,
        limit: 20,
      });
      setGameResults(results);
      if (results.length === 0) setSearchError("NO MATCHING GAMES FOUND.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message.toUpperCase() : "GAME SEARCH FAILED.");
    } finally {
      setSearchingGames(false);
    }
  };

  const handleSelectGame = (result: LiveGameSearchResult) => {
    setSelectedGame(result);
    setGameId(result.game_id);
    toast.success(`Selected ${result.game_id}`);
  };

  const handleClearCaptions = () => {
    clearCaptions();
    toast.success("Caption feed cleared");
  };

  const handleResetSession = async () => {
    if (sessionId && isRunning) {
      try {
        await stopLiveSession(sessionId);
      } catch {
        // best-effort — we're tearing down anyway
      }
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    clearSessionId();
    setStatus("idle");
    clearCaptions();
    setWarnings([]);
    setTeams([]);
    setEventCount(0);
    setProgress(0);
    setLiveClock("—");
    setGameResults([]);
    clearSelectedGame();
    setStreamError(null);
    toast.success("Session reset");
  };

  const sendPlaybackControl = useCallback(
    async (state: "playing" | "paused") => {
      if (!sessionId || !backendReady) return;
      const video = videoRef.current;
      const replayTime = Number.isFinite(video?.currentTime) ? video?.currentTime || 0 : 0;
      const playbackRate = Number.isFinite(video?.playbackRate) ? video?.playbackRate || 1 : 1;
      setVideoCurrentTime(replayTime);
      try {
        await updateLivePlayback(sessionId, {
          state,
          replay_time_sec: replayTime,
          playback_rate: playbackRate,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Playback sync failed";
        setStreamError(message);
        toast.error(message);
      }
    },
    [backendReady, sessionId],
  );

  const handleVideoPlay = () => {
    void sendPlaybackControl("playing");
  };

  const handleVideoPause = () => {
    void sendPlaybackControl("paused");
  };

  const handleVideoSeeking = () => {
    setVideoCurrentTime(videoRef.current?.currentTime || 0);
    void sendPlaybackControl("paused");
  };

  const handleVideoSeeked = () => {
    const video = videoRef.current;
    const state = video && !video.paused && !video.ended ? "playing" : "paused";
    void sendPlaybackControl(state);
  };

  const handleVideoRateChange = () => {
    const video = videoRef.current;
    if (!video) return;
    void sendPlaybackControl(video.paused || video.ended ? "paused" : "playing");
  };

  const handleVideoTimeUpdate = () => {
    setVideoCurrentTime(videoRef.current?.currentTime || 0);
  };

  const teamMatchup = teams.length >= 2 ? `${teams[0]} · ${teams[1]}` : teams[0] || "AWAITING TEAMS";
  const shortSession = sessionId?.slice(0, 8).toUpperCase() || "—";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Masthead
        breadcrumb="01 / LIVE REPLAY"
        rightSlot={
          <span
            className={cn(
              "hidden items-center gap-2 font-mono text-[10px] uppercase tracked tabular md:inline-flex",
              isRunning ? "text-court" : "text-foreground/50",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-2 w-2",
                isRunning ? "animate-live-blink bg-court" : "bg-foreground/30",
              )}
            />
            {status.toUpperCase()}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        {!backendReady && (
          <div className="mb-8 flex items-start gap-4 border-y border-court/60 py-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-court" />
            <div>
              <Marker tone="accent">BACKEND REQUIRED</Marker>
              <p className="mt-1 font-mono text-xs uppercase tracked text-foreground/70">
                SET <span className="text-foreground">VITE_BACKEND_URL</span> · RUN <span className="text-foreground">npm run dev:full</span>
              </p>
            </div>
          </div>
        )}

        {!inBroadcast ? (
          /* PREFLIGHT — setup is the hero */
          <>
            <section>
              <h1 className="max-w-full break-words font-display text-6xl leading-[0.85] sm:text-8xl lg:text-[120px]">
                REPLAY,
                <br />
                CALLED <span className="text-court">LIVE.</span>
              </h1>
            </section>

            {/* A / SOURCE */}
            <section className="mt-12">
              <Rule label="A / SOURCE" marker="REPLAY VIDEO" />
              <div className="mt-6 max-w-3xl space-y-4">
                <div className="flex border border-foreground/40">
                  {(["upload", "url"] as SetupMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "flex-1 py-2.5 font-mono text-[11px] uppercase tracked tabular transition-colors",
                        mode === m
                          ? "bg-foreground text-background"
                          : "text-foreground/55 hover:text-foreground",
                      )}
                    >
                      {m === "upload" ? "UPLOAD FILE" : "PASTE URL"}
                    </button>
                  ))}
                </div>
                {mode === "upload" ? (
                  <label className="flex cursor-pointer items-center gap-3 border border-foreground/40 px-4 py-4 transition-colors hover:border-foreground">
                    <UploadCloud className="h-4 w-4 shrink-0 text-foreground/70" />
                    <span className="flex-1 truncate font-mono text-[11px] uppercase tracked tabular text-foreground">
                      {videoFile ? videoFile.name : "CHOOSE REPLAY VIDEO"}
                    </span>
                    <input
                      type="file"
                      accept="video/mp4,video/*"
                      className="hidden"
                      onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                    />
                  </label>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="video-url">REPLAY VIDEO URL</Label>
                    <Input
                      id="video-url"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder="HTTPS://…"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* B / GAME */}
            <section className="mt-12">
              <Rule label="B / GAME" marker="NBA_API" />
              <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                {/* Search panel */}
                <div className="border border-foreground/25 p-5">
                  <Marker tone="muted">SEARCH BY MATCHUP</Marker>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="team-search">Team</Label>
                      <Input
                        id="team-search"
                        value={teamQuery}
                        onChange={(e) => setTeamQuery(e.target.value)}
                        placeholder="WAS"
                        list="nba-team-options"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="opponent-search">Opponent</Label>
                      <Input
                        id="opponent-search"
                        value={opponentQuery}
                        onChange={(e) => setOpponentQuery(e.target.value)}
                        placeholder="CHA"
                        list="nba-team-options"
                      />
                    </div>
                  </div>
                  <datalist id="nba-team-options">
                    {teamOptions.map((team) => (
                      <option
                        key={team.team_id}
                        value={team.abbreviation || team.name}
                        label={`${team.name}${team.abbreviation ? ` / ${team.abbreviation}` : ""}`}
                      />
                    ))}
                  </datalist>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="space-y-1">
                      <Label htmlFor="season-search">NBA season</Label>
                      <Input
                        id="season-search"
                        value={seasonQuery}
                        onChange={(e) => setSeasonQuery(e.target.value)}
                        placeholder="2023-24"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="sm:mt-5"
                      disabled={searchingGames || !backendReady}
                      onClick={handleGameSearch}
                    >
                      <Search />
                      {searchingGames ? "SEARCHING" : "SEARCH"}
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 border border-foreground/25">
                    {(["Regular Season", "Playoffs"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setSeasonType(option)}
                        className={cn(
                          "py-2 font-mono text-[10px] uppercase tracked tabular transition-colors",
                          seasonType === option
                            ? "bg-court text-ink"
                            : "text-foreground/55 hover:text-foreground",
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {searchError && (
                    <p className="mt-3 font-mono text-[10px] uppercase tracked text-court">
                      ! {searchError}
                    </p>
                  )}
                  {gameResults.length > 0 && (
                    <ol className="mt-4 max-h-64 divide-y divide-foreground/15 overflow-auto border-y border-foreground/15">
                      {gameResults.map((result) => (
                        <li key={result.game_id}>
                          <button
                            type="button"
                            onClick={() => handleSelectGame(result)}
                            className={cn(
                              "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 text-left transition-colors hover:bg-foreground/[0.04]",
                              selectedGame?.game_id === result.game_id && "bg-court/10",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-[11px] uppercase tracked text-foreground">
                                {result.matchup || formatGameTeams(result)}
                              </span>
                              <span className="mt-1 block truncate font-mono text-[10px] uppercase tracked text-foreground/45">
                                {formatGameDate(result.game_date)} · {result.season_type}
                              </span>
                            </span>
                            <span className="text-right font-mono text-[10px] uppercase tracked tabular">
                              <span className="block text-court">{result.game_id}</span>
                              <span className="mt-1 block text-foreground/55">{result.score || result.result || "—"}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                {/* Manual + schedule + start */}
                <div className="space-y-6">
                  <div>
                    <Marker tone="muted">MANUAL ENTRY</Marker>
                    <div className="mt-3 space-y-1">
                      <Label htmlFor="game-id">NBA game id</Label>
                      <Input
                        id="game-id"
                        value={gameId}
                        onChange={(e) => {
                          setGameId(e.target.value);
                          setSelectedGame(null);
                        }}
                        placeholder="0022500001"
                      />
                      {selectedGame && (
                        <p className="font-mono text-[10px] uppercase tracked text-foreground/45">
                          SELECTED · {selectedGame.matchup} · {formatGameDate(selectedGame.game_date)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Marker tone="muted">SCHEDULE</Marker>
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="period">Start period</Label>
                        <Input
                          id="period"
                          value={startPeriod}
                          onChange={(e) => setStartPeriod(e.target.value)}
                          inputMode="numeric"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="clock">Start clock</Label>
                        <Input
                          id="clock"
                          value={startClock}
                          onChange={(e) => setStartClock(e.target.value)}
                          placeholder="12:00"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-foreground/40 pt-6">
                    <Button
                      variant="default"
                      size="lg"
                      className="w-full"
                      disabled={!canStart || busy || !backendReady}
                      onClick={handleStart}
                    >
                      <Radio />
                      {busy ? "STARTING…" : "START REPLAY"}
                    </Button>
                    {!canStart && (
                      <p className="mt-3 font-mono text-[10px] uppercase tracked text-foreground/45">
                        — REQUIRES SOURCE, GAME ID, AND START CLOCK —
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : (
          /* BROADCAST — video + captions side-by-side */
          <>
            {/* Status strip */}
            <section className="border-y border-foreground/40 py-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracked tabular">
                <span
                  className={cn(
                    "flex items-center gap-2",
                    isRunning ? "text-court" : "text-foreground/55",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2",
                      isRunning ? "animate-live-blink bg-court" : "bg-foreground/30",
                    )}
                  />
                  {isRunning ? "ON AIR" : status.toUpperCase()}
                </span>
                <span className="text-foreground">{teamMatchup}</span>
                <span className="text-foreground/55">{liveClock}</span>
                <span className="text-foreground/55">SESSION {shortSession}</span>
                <span className="text-foreground/55">{String(eventCount).padStart(4, "0")} EVENTS</span>
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!sessionId || !isRunning}
                    onClick={handleStop}
                  >
                    <Square />
                    STOP
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="border border-foreground/20 hover:border-foreground"
                    disabled={busy}
                    onClick={handleResetSession}
                  >
                    <RotateCcw />
                    RESET
                  </Button>
                </span>
              </div>
            </section>

            {/* Broadcast: stage + captions side-by-side */}
            <section className="mt-6">
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] xl:items-stretch">
                {/* Video column */}
                <div className="flex min-w-0 flex-col gap-4">
                  <Stage
                    topLeft={
                      <Marker tone={isRunning ? "accent" : "muted"} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={cn(
                            "h-1.5 w-1.5",
                            isRunning ? "animate-live-blink bg-court" : "bg-foreground/30",
                          )}
                        />
                        {isRunning ? "ON AIR" : "STANDBY"}
                      </Marker>
                    }
                    topRight={<Marker>{liveClock}</Marker>}
                    bottomLeft={<Marker tone="muted">{teamMatchup}</Marker>}
                    bottomRight={<Marker tone="muted">{shortSession}</Marker>}
                  >
                    {previewUrl ? (
                      <video
                        ref={videoRef}
                        src={previewUrl}
                        controls
                        playsInline
                        onPlay={handleVideoPlay}
                        onPause={handleVideoPause}
                        onSeeking={handleVideoSeeking}
                        onSeeked={handleVideoSeeked}
                        onRateChange={handleVideoRateChange}
                        onTimeUpdate={handleVideoTimeUpdate}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground/40">
                        <FileVideo className="h-10 w-10" strokeWidth={1.25} />
                        <Marker tone="muted">— REPLAY POPULATES ON SESSION START —</Marker>
                      </div>
                    )}
                  </Stage>

                  {/* Inline metrics */}
                  <div className="border-y border-foreground/40 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                      <Metric label="GAME CLOCK" value={liveClock} accent={isRunning} />
                      <Metric label="LATENCY" value={formatLatency(latestCaption?.latency_ms) || "—"} />
                      <Metric label="SOURCE" value={(latestCaption?.source && sourceLabel[latestCaption.source]) || "—"} />
                      <Metric label="EVENTS" value={String(eventCount).padStart(4, "0")} />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="shrink-0 font-mono text-[10px] uppercase tracked text-foreground/55">PROGRESS</span>
                      <Progress value={progress} className="flex-1" />
                      <span className="font-mono text-[10px] uppercase tracked tabular text-foreground/55">
                        {progress.toFixed(0).padStart(3, "0")}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Captions column */}
                <div className="flex h-[640px] max-h-[calc(100vh-8rem)] min-w-0 flex-col border border-foreground/[var(--rule-alpha,0.18)]">
                  <div className="flex items-center justify-between gap-3 border-b border-foreground/[var(--rule-alpha,0.18)] px-4 py-3">
                    <div className="flex items-baseline gap-3">
                      <Marker>D / CAPTION FEED</Marker>
                      <span className="font-mono text-[10px] uppercase tracked tabular text-foreground/45">
                        {String(visibleCaptions.length).padStart(2, "0")} LINES · 3S CADENCE
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={visibleCaptions.length === 0}
                      onClick={handleClearCaptions}
                      title="Clear visible captions — new ones will stream in as the replay continues"
                    >
                      <Eraser />
                      CLEAR
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {visibleCaptions.length === 0 ? (
                      <p className="px-4 py-10 text-center font-mono text-[11px] uppercase tracked text-foreground/45">
                        — STREAMING WILL POPULATE THIS COLUMN —
                      </p>
                    ) : (
                      <ol className="divide-y divide-foreground/[var(--rule-alpha,0.18)]">
                        {visibleCaptions.map((caption, i) => (
                          <li
                            key={caption.event_id}
                            className={cn(
                              "px-4 py-4",
                              i === 0 && "bg-foreground/[0.04]",
                            )}
                          >
                            <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracked tabular">
                              <span className="text-foreground tabular">
                                {formatReplayTime(caption.replay_time_sec)}
                                <span className="ml-2 text-foreground/45">
                                  Q{caption.period} · {caption.clock}
                                </span>
                              </span>
                              <span className="text-foreground/55">
                                {sourceLabel[caption.source] || caption.source.toUpperCase()}
                              </span>
                            </div>
                            <p className="mt-2 font-body text-base leading-[1.45] text-foreground">
                              <span className="text-foreground/40">— </span>
                              {caption.text}
                            </p>
                            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracked tabular text-foreground/55">
                              <span>{caption.player_name || caption.team_name || caption.event_type}</span>
                              <span className="flex items-baseline gap-3">
                                {caption.score && <span className="text-court tabular">{caption.score}</span>}
                                <span className="text-foreground/40">{formatLatency(caption.latency_ms)}</span>
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Notes */}
            {(warnings.length > 0 || streamError) && (
              <section className="mt-10">
                <Rule label="E / NOTES" marker={streamError ? "STREAM" : "PROVIDER"} />
                <div className="mt-4 space-y-2 font-mono text-[11px] uppercase tracked tabular">
                  {streamError && <p className="text-court">! {streamError}</p>}
                  {warnings.map((w, i) => (
                    <p key={i} className="text-foreground/65">· {w}</p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const Metric = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => (
  <div className="flex flex-col gap-1">
    <span className="font-mono text-[10px] uppercase tracked text-foreground/55">{label}</span>
    <span className={cn("font-mono text-base tabular leading-tight", accent ? "text-court" : "text-foreground")}>
      {value}
    </span>
  </div>
);

const defaultNbaSeason = (): string => {
  const now = new Date();
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};

const formatGameDate = (value: string): string => {
  if (!value) return "DATE TBD";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
};

const formatGameTeams = (result: LiveGameSearchResult): string => {
  if (result.away_team && result.home_team) return `${result.away_team} @ ${result.home_team}`;
  return `${result.team_abbreviation} vs ${result.opponent_abbreviation}`;
};

export default LiveReplay;
