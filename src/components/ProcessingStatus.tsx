import { Progress } from "@/components/ui/progress";
import { Marker } from "@/components/almanac";
import { cn } from "@/lib/utils";

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
  { key: "uploading", label: "TRANSMITTING CLIP" },
  { key: "processing", label: "REGISTERING RECORD" },
  { key: "detecting", label: "DETECTING EVENT" },
  { key: "retrieving", label: "RETRIEVING CONTEXT" },
  { key: "generating", label: "WRITING THE CALL" },
] as const;

const stepOrder = steps.map((s) => s.key);

const ProcessingStatus = ({ currentStep, error }: ProcessingStatusProps) => {
  if (currentStep === "complete" && !error) return null;

  if (error) {
    return (
      <div className="border-y border-destructive/60 py-5">
        <div className="flex items-baseline justify-between gap-6">
          <Marker tone="accent">FAULT / 500</Marker>
          <span className="font-mono text-[10px] uppercase tracked text-destructive">PROCESSING FAILED</span>
        </div>
        <p className="mt-2 font-body text-sm italic text-foreground/85">{error}</p>
      </div>
    );
  }

  const currentIndex = stepOrder.indexOf(currentStep as (typeof stepOrder)[number]);
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const pct = Math.round(((safeIndex + 1) / stepOrder.length) * 100);
  const active = steps[safeIndex];

  return (
    <div className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracked tabular">
        <div className="flex items-baseline gap-3">
          <span className="text-foreground/55">
            STEP {String(safeIndex + 1).padStart(2, "0")}/{String(stepOrder.length).padStart(2, "0")}
          </span>
          <span className="text-foreground">{active.label}</span>
        </div>
        <span className="text-foreground/55 tabular">{String(pct).padStart(3, "0")}%</span>
      </div>

      <Progress value={pct} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracked tabular text-foreground/40">
        {steps.map((step, i) => {
          const isActive = step.key === currentStep;
          const isDone = currentIndex > i;
          return (
            <span
              key={step.key}
              className={cn(
                "transition-colors",
                isActive && "text-foreground",
                isDone && "text-foreground/65 line-through decoration-foreground/30",
              )}
            >
              {String(i + 1).padStart(2, "0")} {step.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default ProcessingStatus;
