import { cn } from "@/lib/utils";

interface MarkerProps {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "muted" | "accent";
}

export function Marker({ children, className, tone = "default" }: MarkerProps) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracked tabular",
        tone === "default" && "text-foreground",
        tone === "muted" && "text-foreground/50",
        tone === "accent" && "text-court",
        className,
      )}
    >
      {children}
    </span>
  );
}
