import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-foreground">
      <span className="font-mono text-[11px] uppercase tracked tabular text-foreground/55">
        FILE NOT FOUND / 404
      </span>
      <h1 className="font-display text-[180px] leading-[0.8] sm:text-[240px]">
        4<span className="text-court">0</span>4
      </h1>
      <p className="max-w-md text-center font-body text-base italic text-foreground/65">
        The page <span className="font-mono text-foreground">{location.pathname}</span> was either pulled from
        the press or never set in type.
      </p>
      <a
        href="/"
        className="font-mono text-[11px] uppercase tracked tabular text-foreground underline decoration-court decoration-2 underline-offset-[6px] hover:opacity-70"
      >
        ← RETURN TO DESK
      </a>
    </div>
  );
};

export default NotFound;
