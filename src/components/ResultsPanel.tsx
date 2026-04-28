import { Copy, Download, Loader2, Mic, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataTable, Marker, Rule, Stage } from "@/components/almanac";

import {
  exportCommentaryVideo,
  getBackendBaseUrl,
  type AnalysisResult,
  type PossessionSegment,
} from "@/lib/analysis";

function activeSegmentIndex(segs: PossessionSegment[], normalizedT: number): number {
  const x = Math.min(1, Math.max(0, normalizedT));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const end = i === segs.length - 1 ? 1 + 1e-6 : s.t1;
    if (x >= s.t0 && x < end) return i;
  }
  return Math.max(0, segs.length - 1);
}

interface ResultsPanelProps {
  clipId: string;
  fileUrl: string;
  result: AnalysisResult;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

const formatStatLabel = (key: string) => key.replace(/_/g, " ").toUpperCase();

const RatingInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) => (
  <div className="flex flex-col gap-2">
    <span className="font-mono text-[10px] uppercase tracked text-foreground/55">{label}</span>
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            "flex h-6 w-6 items-center justify-center border font-mono text-[11px] tabular leading-none transition-colors",
            n <= value
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/30 text-foreground/35 hover:border-foreground/70 hover:text-foreground",
          )}
          aria-label={`${label} ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  </div>
);

const ResultsPanel = ({
  clipId,
  fileUrl,
  result,
  onRegenerate,
  isRegenerating,
}: ResultsPanelProps) => {
  const [fluency, setFluency] = useState(0);
  const [factual, setFactual] = useState(0);
  const [style, setStyle] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverBusy, setVoiceoverBusy] = useState(false);
  const [videoTab, setVideoTab] = useState<"original" | "voiceover">("original");
  const [playheadNorm, setPlayheadNorm] = useState(0);

  const backendUrl = getBackendBaseUrl();
  const timeline = result.possession_timeline;
  const segIdx =
    timeline && timeline.length > 0 ? activeSegmentIndex(timeline, playheadNorm) : -1;
  const seg = segIdx >= 0 && timeline ? timeline[segIdx] : null;
  const displayEvent = seg?.event_type ?? result.event_type;
  const displayPlayer = seg?.player_name ?? result.player_name;
  const displayTeam = seg?.team_name ?? result.team_name;
  const liveLine =
    segIdx >= 0 && result.segment_commentary_lines && result.segment_commentary_lines[segIdx]
      ? result.segment_commentary_lines[segIdx]
      : null;

  const onVideoTime = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const d = v.duration;
    if (d && Number.isFinite(d) && d > 0) {
      setPlayheadNorm(v.currentTime / d);
    }
  };

  useEffect(() => {
    return () => {
      if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl);
    };
  }, [voiceoverUrl]);

  useEffect(() => {
    setVoiceoverUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setVideoTab("original");
    setPlayheadNorm(0);
  }, [fileUrl, result.commentary_text, result.possession_timeline, result.segment_commentary_lines]);

  const handleBuildVoiceover = async () => {
    if (!backendUrl) {
      toast.error("Add VITE_BACKEND_URL in .env and restart the dev server.");
      return;
    }
    setVoiceoverBusy(true);
    try {
      const blob = await exportCommentaryVideo(fileUrl, result.commentary_text, {
        possession_timeline: result.possession_timeline,
        segment_commentary_lines: result.segment_commentary_lines,
      });
      const url = URL.createObjectURL(blob);
      if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl);
      setVoiceoverUrl(url);
      setVideoTab("voiceover");
      toast.success("Voiceover ready — switch to the voiceover tab.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Voiceover export failed");
    } finally {
      setVoiceoverBusy(false);
    }
  };

  const handleDownloadVoiceover = () => {
    if (!voiceoverUrl) return;
    const a = document.createElement("a");
    a.href = voiceoverUrl;
    a.download = `vision2voice-voiceover-${clipId.slice(0, 8)}.mp4`;
    a.click();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result.commentary_text);
    toast.success("Commentary copied");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("evaluations").insert({
        clip_id: clipId,
        fluency_score: fluency,
        factual_score: factual,
        style_score: style,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success("Evaluation logged");
    } catch {
      toast.error("Failed to save evaluation");
    } finally {
      setSaving(false);
    }
  };

  const playerStats = result.retrieved_context?.player_stats;
  const teamStats = result.retrieved_context?.team_stats;

  type StatRow = { metric: string; value: string | number };
  const playerRows: StatRow[] = useMemo(
    () =>
      playerStats
        ? Object.entries(playerStats)
            .map(([k, v]) => ({ metric: formatStatLabel(k), value: v as string | number }))
            .sort((a, b) => a.metric.localeCompare(b.metric))
        : [],
    [playerStats],
  );
  const teamRows: StatRow[] = useMemo(
    () =>
      teamStats
        ? Object.entries(teamStats)
            .map(([k, v]) => ({ metric: formatStatLabel(k), value: v as string | number }))
            .sort((a, b) => a.metric.localeCompare(b.metric))
        : [],
    [teamStats],
  );

  const confidencePct = (result.confidence * 100).toFixed(1);
  const shortClipId = clipId.slice(0, 8).toUpperCase();

  return (
    <article className="space-y-12">
      {/* 02 — VIDEO */}
      <section>
        <Rule label="02 / VIDEO" marker={`CLIP ${shortClipId}`} />
        <Tabs
          value={videoTab}
          onValueChange={(v) => setVideoTab(v as "original" | "voiceover")}
          className="mt-6"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <TabsList>
              <TabsTrigger value="original">Original</TabsTrigger>
              <TabsTrigger value="voiceover" disabled={!voiceoverUrl}>
                AI Voiceover
              </TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={voiceoverBusy || !backendUrl}
                onClick={handleBuildVoiceover}
                title={
                  backendUrl
                    ? "Synthesize speech and mux onto the video."
                    : "Set VITE_BACKEND_URL for voiceover."
                }
              >
                {voiceoverBusy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Mic />
                )}
                {voiceoverBusy ? "Building" : "Build voiceover"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!voiceoverUrl}
                onClick={handleDownloadVoiceover}
              >
                <Download />
                MP4
              </Button>
            </div>
          </div>

          {!backendUrl && (
            <p className="mt-3 font-mono text-[10px] uppercase tracked text-foreground/50">
              VOICEOVER NEEDS THE PYTHON API · SET VITE_BACKEND_URL · RUN <span className="text-foreground">npm run dev:full</span>
            </p>
          )}

          <TabsContent value="original" className="m-0 mt-4">
            <Stage
              topLeft={<Marker>FRAME · {String(Math.round(playheadNorm * 100)).padStart(2, "0")}%</Marker>}
              topRight={<Marker tone="accent">● ANALYZING</Marker>}
              bottomLeft={<Marker tone="muted">{displayEvent?.toUpperCase() || "EVENT"}</Marker>}
              bottomRight={<Marker tone="muted">{displayTeam?.toUpperCase() || "—"}</Marker>}
            >
              <video
                key={fileUrl}
                src={fileUrl}
                controls
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
                onTimeUpdate={onVideoTime}
                onSeeked={onVideoTime}
                onLoadedMetadata={onVideoTime}
              />
            </Stage>
          </TabsContent>
          <TabsContent value="voiceover" className="m-0 mt-4">
            {voiceoverUrl ? (
              <Stage
                topLeft={<Marker tone="accent">● VOICEOVER</Marker>}
                topRight={<Marker>{shortClipId}</Marker>}
              >
                <video
                  key={voiceoverUrl}
                  src={voiceoverUrl}
                  controls
                  playsInline
                  className="absolute inset-0 h-full w-full object-contain"
                  onTimeUpdate={onVideoTime}
                  onSeeked={onVideoTime}
                  onLoadedMetadata={onVideoTime}
                />
              </Stage>
            ) : (
              <p className="border border-foreground/[var(--rule-alpha,0.18)] px-6 py-12 text-center font-mono text-[11px] uppercase tracked text-foreground/50">
                — BUILD VOICEOVER TO POPULATE THIS FRAME —
              </p>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* 03 — METADATA */}
      <section>
        <Rule label="03 / READ" marker="FIG.02" />
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <MetaCell label="EVENT" value={displayEvent} />
          <MetaCell label="PLAYER" value={displayPlayer} />
          <MetaCell label="TEAM" value={displayTeam} />
          <MetaCell label="CONF" value={`${confidencePct}%`} accent />
        </dl>
        {result.visual_summary && (
          <p className="mt-6 max-w-3xl border-l border-foreground/40 pl-4 font-body text-base italic leading-relaxed text-foreground/85">
            {result.visual_summary}
          </p>
        )}
      </section>

      {/* 04 — COMMENTARY */}
      <section>
        <div className="flex items-center justify-between">
          <Rule label="04 / COMMENTARY" marker="THE CALL" className="flex-1" />
          <div className="ml-4 flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={isRegenerating}>
              <RefreshCw className={isRegenerating ? "animate-spin" : ""} />
              Regenerate
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              <Copy />
              Copy
            </Button>
          </div>
        </div>

        <blockquote className="mt-8 max-w-4xl">
          <span className="block font-display text-court text-[80px] leading-none">&ldquo;</span>
          <p className="mt-2 font-body text-2xl leading-[1.4] text-foreground sm:text-3xl">
            {result.commentary_text}
          </p>
        </blockquote>

        {liveLine && (
          <div className="mt-6 flex max-w-3xl gap-4 border-t border-foreground/[var(--rule-alpha,0.18)] pt-4">
            <Marker tone="muted">AT PLAYHEAD</Marker>
            <p className="flex-1 font-body text-sm italic text-foreground/75">{liveLine}</p>
          </div>
        )}
      </section>

      {/* 05 — BOXSCORE */}
      {(playerRows.length > 0 || teamRows.length > 0) && (
        <section>
          <Rule label="05 / BOXSCORE" marker="RETRIEVED CONTEXT" />
          <div className="mt-6 grid gap-10 lg:grid-cols-2">
            {playerRows.length > 0 && (
              <DataTable
                rows={playerRows}
                caption={`PLAYER · ${displayPlayer?.toUpperCase() || "—"}`}
                columns={[
                  { key: "metric", header: "METRIC" },
                  { key: "value", header: "VALUE", align: "right" },
                ]}
              />
            )}
            {teamRows.length > 0 && (
              <DataTable
                rows={teamRows}
                caption={`TEAM · ${displayTeam?.toUpperCase() || "—"}`}
                columns={[
                  { key: "metric", header: "METRIC" },
                  { key: "value", header: "VALUE", align: "right" },
                ]}
              />
            )}
          </div>
        </section>
      )}

      {/* 06 — RATING */}
      <section>
        <Rule label="06 / GRADE" marker="EVAL" />
        <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-6">
          <RatingInput label="FLUENCY" value={fluency} onChange={setFluency} />
          <RatingInput label="FACTUAL" value={factual} onChange={setFactual} />
          <RatingInput label="STYLE" value={style} onChange={setStyle} />
        </div>
        <Textarea
          placeholder="Marginalia — what worked, what missed, what would a real broadcaster have said..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-6"
        />
        <div className="mt-4">
          <Button
            variant="default"
            onClick={handleSave}
            disabled={saving || (fluency === 0 && factual === 0 && style === 0)}
          >
            <Save />
            {saving ? "Logging" : "Log evaluation"}
          </Button>
        </div>
      </section>
    </article>
  );
};

const MetaCell = ({
  label,
  value,
  accent = false,
}: {
  label: string;
  value?: string | number | null;
  accent?: boolean;
}) => (
  <div className="border-t border-foreground/40 pt-3">
    <dt className="font-mono text-[10px] uppercase tracked text-foreground/55">{label}</dt>
    <dd
      className={cn(
        "mt-1 font-display text-2xl leading-none sm:text-3xl",
        accent ? "text-court" : "text-foreground",
      )}
    >
      {value ?? "—"}
    </dd>
  </div>
);

export default ResultsPanel;
