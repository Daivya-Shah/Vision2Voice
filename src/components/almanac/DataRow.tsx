import { cn } from "@/lib/utils";

interface DataRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
  accent?: boolean;
}

export function DataRow({ label, value, className, accent = false }: DataRowProps) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-foreground/[var(--rule-alpha,0.18)] py-2",
        className,
      )}
    >
      <span className="font-mono text-[10px] uppercase tracked text-foreground/55">{label}</span>
      <span
        className={cn(
          "font-mono text-sm tabular",
          accent ? "text-court" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
