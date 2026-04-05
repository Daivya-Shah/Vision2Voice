import { Check, Loader2 } from "lucide-react";

export type ProcessingStep =
  | "uploading"
  | "processing"
  | "detecting"
  | "retrieving"
  | "generating"
  | "complete"
  | "error";

interface ProcessingStatusProps {
  currentStep: ProcessingStep;
  error?: string;
}

const steps = [
  { key: "uploading", label: "Uploading video" },
  { key: "processing", label: "Processing video" },
  { key: "detecting", label: "Detecting event" },
  { key: "retrieving", label: "Retrieving player/team context" },
  { key: "generating", label: "Generating commentary" },
] as const;

const stepOrder = steps.map((s) => s.key);

const ProcessingStatus = ({ currentStep, error }: ProcessingStatusProps) => {
  if (currentStep === "complete" && !error) return null;

  const currentIndex = stepOrder.indexOf(currentStep as any);

  return (
    <div className="mx-auto max-w-md py-8">
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="font-display text-lg font-semibold text-destructive">
            Processing Failed
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {steps.map((step, i) => {
            const isActive = step.key === currentStep;
            const isDone = currentIndex > i || currentStep === "complete";

            return (
              <div
                key={step.key}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-300 ${
                  isActive
                    ? "glass-card progress-glow"
                    : isDone
                    ? "opacity-60"
                    : "opacity-30"
                }`}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full">
                  {isDone ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                  )}
                </div>
                <span
                  className={`font-body text-sm ${
                    isActive
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProcessingStatus;
