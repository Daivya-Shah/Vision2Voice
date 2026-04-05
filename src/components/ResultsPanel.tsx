import { Copy, RefreshCw, Save, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AnalysisResult {
  event_type: string;
  player_name: string;
  team_name: string;
  confidence: number;
  visual_summary: string;
  retrieved_context?: {
    player_stats?: Record<string, any>;
    team_stats?: Record<string, any>;
  };
  commentary_text: string;
}

interface ResultsPanelProps {
  clipId: string;
  fileUrl: string;
  result: AnalysisResult;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

const confidenceColor = (c: number) =>
  c >= 0.8 ? "text-primary" : c >= 0.5 ? "text-accent" : "text-destructive";

const RatingInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          className="transition-colors"
        >
          <Star
            className={`h-4 w-4 ${
              star <= value
                ? "fill-accent text-accent"
                : "text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  </div>
);

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg bg-secondary/50 px-3 py-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-display text-sm font-semibold text-foreground">{String(value)}</p>
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

  const handleCopy = () => {
    navigator.clipboard.writeText(result.commentary_text);
    toast.success("Commentary copied to clipboard");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from("evaluations").insert({
        clip_id: clipId,
        fluency_score: fluency,
        factual_score: factual,
        style_score: style,
        notes: notes || null,
      });
      toast.success("Evaluation saved");
    } catch {
      toast.error("Failed to save evaluation");
    } finally {
      setSaving(false);
    }
  };

  const playerStats = result.retrieved_context?.player_stats;
  const teamStats = result.retrieved_context?.team_stats;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      {/* Video Player */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <video
          src={fileUrl}
          controls
          className="w-full"
          style={{ maxHeight: "480px" }}
        />
      </div>

      {/* Detection Info */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Event</p>
          <p className="font-display text-xl font-bold text-foreground">{result.event_type}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Player</p>
          <p className="font-display text-xl font-bold text-foreground">{result.player_name}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Team</p>
          <p className="font-display text-xl font-bold text-foreground">{result.team_name}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Confidence</p>
          <p className={`font-display text-xl font-bold ${confidenceColor(result.confidence)}`}>
            {(result.confidence * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Visual Summary */}
      <div className="glass-card rounded-xl p-5">
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
          Visual Summary
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">{result.visual_summary}</p>
      </div>

      {/* Retrieved Context */}
      {(playerStats || teamStats) && (
        <div className="grid gap-4 md:grid-cols-2">
          {playerStats && (
            <div className="glass-card rounded-xl p-5">
              <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                Player Stats
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(playerStats).map(([key, val]) => (
                  <StatCard
                    key={key}
                    label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={val as string | number}
                  />
                ))}
              </div>
            </div>
          )}
          {teamStats && (
            <div className="glass-card rounded-xl p-5">
              <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                Team Stats
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(teamStats).map(([key, val]) => (
                  <StatCard
                    key={key}
                    label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={val as string | number}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Commentary */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Generated Commentary
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isRegenerating}
              className="border-border text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${isRegenerating ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="border-border text-muted-foreground hover:text-foreground"
            >
              <Copy className="mr-1 h-3 w-3" />
              Copy
            </Button>
          </div>
        </div>
        <p className="text-base leading-relaxed text-foreground/95 italic">
          "{result.commentary_text}"
        </p>
      </div>

      {/* Rating & Save */}
      <div className="glass-card rounded-xl p-5">
        <p className="mb-4 text-xs uppercase tracking-wider text-muted-foreground">
          Rate This Result
        </p>
        <div className="flex flex-wrap gap-6">
          <RatingInput label="Fluency" value={fluency} onChange={setFluency} />
          <RatingInput label="Factual Accuracy" value={factual} onChange={setFactual} />
          <RatingInput label="Commentary Style" value={style} onChange={setStyle} />
        </div>
        <Textarea
          placeholder="Additional notes (optional)..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-4 border-border bg-secondary/30 text-foreground placeholder:text-muted-foreground"
        />
        <Button
          onClick={handleSave}
          disabled={saving || (fluency === 0 && factual === 0 && style === 0)}
          className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving..." : "Save Evaluation"}
        </Button>
      </div>
    </div>
  );
};

export default ResultsPanel;
