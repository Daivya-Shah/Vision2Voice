import { cn } from "@/lib/utils";

interface StageProps {
  children: React.ReactNode;
  className?: string;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  bottomLeft?: React.ReactNode;
  bottomRight?: React.ReactNode;
  aspect?: "video" | "auto";
}

export function Stage({
  children,
  className,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  aspect = "video",
}: StageProps) {
  return (
    <div
      className={cn(
        "relative w-full min-w-0 overflow-hidden bg-background",
        "border border-foreground/[var(--rule-alpha,0.18)]",
        aspect === "video" && "aspect-video",
        className,
      )}
    >
      {children}
      {topLeft && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate">{topLeft}</div>
      )}
      {topRight && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate">{topRight}</div>
      )}
      {bottomLeft && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] truncate">{bottomLeft}</div>
      )}
      {bottomRight && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 max-w-[calc(100%-1.5rem)] truncate">{bottomRight}</div>
      )}
    </div>
  );
}
