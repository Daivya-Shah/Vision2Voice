import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface MastheadProps {
  breadcrumb?: string;
  rightSlot?: React.ReactNode;
  className?: string;
}

export function Masthead({ rightSlot, className }: MastheadProps) {
  const location = useLocation();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full bg-background/95 backdrop-blur-[2px]",
        "border-b border-foreground/40",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[1400px] min-w-0 items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="min-w-0 shrink truncate font-display text-lg leading-none tracking-tight transition-opacity hover:opacity-70"
        >
          VISION<span className="text-court">/</span>2<span className="text-court">/</span>VOICE
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <NavItem to="/" label="DESK" active={location.pathname === "/"} />
          <NavItem to="/live" label="LIVE REPLAY" active={location.pathname === "/live"} />
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          {rightSlot}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "font-mono text-[11px] uppercase tracked transition-colors",
        active
          ? "text-foreground underline decoration-court decoration-2 underline-offset-[6px]"
          : "text-foreground/55 hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
