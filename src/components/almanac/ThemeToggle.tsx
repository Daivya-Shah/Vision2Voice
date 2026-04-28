import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={cn(
        "group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracked tabular",
        "border border-foreground/40 px-2 py-1.5 leading-none",
        "transition-colors hover:bg-foreground hover:text-background",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "px-1",
          theme === "dark" ? "bg-foreground text-background" : "text-foreground/50",
        )}
      >
        DARK
      </span>
      <span aria-hidden="true" className="text-foreground/30">/</span>
      <span
        aria-hidden="true"
        className={cn(
          "px-1",
          theme === "light" ? "bg-foreground text-background" : "text-foreground/50",
        )}
      >
        LIGHT
      </span>
    </button>
  );
}
