import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import UploadZone from "@/components/UploadZone";
import ProcessingStatus, { type ProcessingStep } from "@/components/ProcessingStatus";
import ResultsPanel from "@/components/ResultsPanel";
import { runAnalysisPipeline, type AnalysisResult } from "@/lib/analysis";
import { Masthead, Rule } from "@/components/almanac";
import { usePersistentState } from "@/hooks/usePersistentState";

interface OfflineAnalysisState {
  step: ProcessingStep | null;
  error?: string;
  clipId?: string;
  fileUrl?: string;
  result?: AnalysisResult;
}

const initialOfflineState: OfflineAnalysisState = {
  step: null,
};

const Index = () => {
  const [analysisState, setAnalysisState, clearAnalysisState] = usePersistentState(
    "vision2voice.offlineAnalysis.v1",
    initialOfflineState,
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const { step, error, clipId, fileUrl, result } = analysisState;

  const processVideo = useCallback(async (file: File) => {
    setAnalysisState({ step: "uploading" });

    try {
      const fileName = `${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(fileName, file);
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage
        .from("videos")
        .getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      setAnalysisState({ step: "processing" });
      const { data: clip, error: clipError } = await supabase
        .from("clips")
        .insert({ title: file.name, file_url: publicUrl })
        .select()
        .single();
      if (clipError || !clip) throw new Error("Failed to save clip record");

      setAnalysisState({ step: "processing", clipId: clip.id, fileUrl: publicUrl });

      setAnalysisState({ step: "detecting", clipId: clip.id, fileUrl: publicUrl });
      await delay(800);
      setAnalysisState({ step: "retrieving", clipId: clip.id, fileUrl: publicUrl });
      await delay(600);
      setAnalysisState({ step: "generating", clipId: clip.id, fileUrl: publicUrl });

      const payload = await runAnalysisPipeline(clip.id, publicUrl);
      setAnalysisState({ step: "complete", clipId: clip.id, fileUrl: publicUrl, result: payload });
    } catch (err: unknown) {
      setAnalysisState((current) => ({
        ...current,
        error: err instanceof Error ? err.message : "Something went wrong",
        step: "error",
      }));
    }
  }, [setAnalysisState]);

  const handleRegenerate = useCallback(async () => {
    if (!clipId || !fileUrl) return;
    setIsRegenerating(true);
    try {
      const payload = await runAnalysisPipeline(clipId, fileUrl, "regenerate");
      setAnalysisState((current) => ({ ...current, result: payload, step: "complete" }));
    } catch {
      // keep existing result
    } finally {
      setIsRegenerating(false);
    }
  }, [clipId, fileUrl, setAnalysisState]);

  const reset = () => {
    clearAnalysisState();
  };

  const isProcessing = !!step && step !== "complete" && step !== "error";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Masthead breadcrumb="00 / DESK" />

      <main className="mx-auto w-full max-w-[1400px] px-6 pb-24 pt-10 sm:px-10">
        {/* Hero */}
        <section className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="font-display text-[88px] leading-[0.82] sm:text-[128px] md:text-[180px]">
              ANALYZE
              <br />
              <span className="text-court">THE PLAY.</span>
            </h1>
          </div>
          <Link
            to="/live"
            className="group inline-flex items-center gap-3 self-start border border-foreground/40 px-5 py-3 font-mono text-[11px] uppercase tracked tabular text-foreground transition-colors hover:bg-foreground hover:text-background lg:self-end"
          >
            <span className="h-2 w-2 animate-live-blink bg-court" aria-hidden />
            <span>LIVE REPLAY DESK</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </section>

        {/* Upload */}
        <section className="mt-16">
          <Rule label="01 / UPLOAD" marker="DROP AREA" />
          <div className="mt-6">
            <UploadZone onFileSelect={processVideo} isProcessing={isProcessing || !!result} />
          </div>
        </section>

        {/* Processing */}
        {step && step !== "complete" && (
          <section className="mt-12">
            <Rule label="01·B / PROCESSING" marker="PIPELINE" />
            <ProcessingStatus currentStep={step} error={error} />
          </section>
        )}

        {/* Results */}
        {result && clipId && fileUrl && (
          <section className="mt-16">
            <ResultsPanel
              clipId={clipId}
              fileUrl={fileUrl}
              result={result}
              onRegenerate={handleRegenerate}
              isRegenerating={isRegenerating}
            />
          </section>
        )}

        {result && (
          <div className="mt-16 flex items-center gap-4 border-t border-foreground/40 pt-6">
            <button
              type="button"
              onClick={reset}
              className="font-mono text-[11px] uppercase tracked tabular text-foreground underline decoration-court decoration-2 underline-offset-[6px] transition-opacity hover:opacity-70"
            >
              FILE A NEW CLIP →
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default Index;
