import { cn } from "@/lib/utils";

interface RuleProps {
  label?: string;
  align?: "left" | "center" | "right";
  className?: string;
  strong?: boolean;
  marker?: string;
}

export function Rule({ label, align = "left", className, strong = false, marker }: RuleProps) {
  if (!label && !marker) {
    return (
      <hr
        className={cn(
          "h-px w-full border-0",
          strong ? "bg-foreground/50" : "bg-foreground/[var(--rule-alpha,0.18)]",
          className,
        )}
      />
    );
  }

  return (
    <div className={cn("flex w-full items-center gap-4", className)}>
      {align !== "left" && (
        <hr
          className={cn(
            "h-px flex-1 border-0",
            strong ? "bg-foreground/50" : "bg-foreground/[var(--rule-alpha,0.18)]",
          )}
        />
      )}
      <div className="flex shrink-0 items-baseline gap-3">
        {marker && (
          <span className="font-mono text-[10px] tracked text-foreground/50 tabular">{marker}</span>
        )}
        {label && (
          <span className="font-mono text-[10px] tracked uppercase text-foreground">{label}</span>
        )}
      </div>
      {align !== "right" && (
        <hr
          className={cn(
            "h-px flex-1 border-0",
            strong ? "bg-foreground/50" : "bg-foreground/[var(--rule-alpha,0.18)]",
          )}
        />
      )}
    </div>
  );
}
