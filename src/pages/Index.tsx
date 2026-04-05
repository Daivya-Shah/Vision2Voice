import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import UploadZone from "@/components/UploadZone";
import ProcessingStatus, { type ProcessingStep } from "@/components/ProcessingStatus";
import ResultsPanel from "@/components/ResultsPanel";

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

const Index = () => {
  const [step, setStep] = useState<ProcessingStep | null>(null);
  const [error, setError] = useState<string>();
  const [clipId, setClipId] = useState<string>();
  const [fileUrl, setFileUrl] = useState<string>();
  const [result, setResult] = useState<AnalysisResult>();
  const [isRegenerating, setIsRegenerating] = useState(false);

  const processVideo = useCallback(async (file: File) => {
    setError(undefined);
    setResult(undefined);
    setStep("uploading");

    try {
      // 1. Upload to storage
      const fileName = `${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(fileName, file);

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage
        .from("videos")
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      // 2. Create clip record
      setStep("processing");
      const { data: clip, error: clipError } = await supabase
        .from("clips")
        .insert({ title: file.name, file_url: publicUrl })
        .select()
        .single();

      if (clipError || !clip) throw new Error("Failed to save clip record");

      setClipId(clip.id);
      setFileUrl(publicUrl);

      // 3. Simulate progress steps while calling backend
      setStep("detecting");
      await delay(800);
      setStep("retrieving");
      await delay(600);
      setStep("generating");

      // 4. Call edge function
      const { data, error: fnError } = await supabase.functions.invoke(
        "process-video",
        {
          body: { clip_id: clip.id, file_url: publicUrl },
        }
      );

      if (fnError) throw new Error(fnError.message);

      setResult(data as AnalysisResult);
      setStep("complete");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setStep("error");
    }
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (!clipId || !fileUrl) return;
    setIsRegenerating(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "process-video",
        {
          body: { clip_id: clipId, file_url: fileUrl, action: "regenerate" },
        }
      );
      if (fnError) throw fnError;
      setResult(data as AnalysisResult);
    } catch {
      // keep existing result
    } finally {
      setIsRegenerating(false);
    }
  }, [clipId, fileUrl]);

  const isProcessing = !!step && step !== "complete" && step !== "error";

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-12 text-center">
        <h1 className="font-display text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          Vision<span className="text-primary">2</span>Voice
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a basketball clip · Get instant AI commentary
        </p>
      </header>

      {/* Upload Zone */}
      <UploadZone onFileSelect={processVideo} isProcessing={isProcessing || !!result} />

      {/* Processing Status */}
      {step && step !== "complete" && (
        <ProcessingStatus currentStep={step} error={error} />
      )}

      {/* Results */}
      {result && clipId && fileUrl && (
        <ResultsPanel
          clipId={clipId}
          fileUrl={fileUrl}
          result={result}
          onRegenerate={handleRegenerate}
          isRegenerating={isRegenerating}
        />
      )}

      {/* Reset button when results are shown */}
      {result && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setStep(null);
              setResult(undefined);
              setClipId(undefined);
              setFileUrl(undefined);
            }}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Upload another clip
          </button>
        </div>
      )}
    </div>
  );
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default Index;
