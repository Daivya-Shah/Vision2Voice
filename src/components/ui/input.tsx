import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full border-0 border-b border-foreground/40 bg-transparent px-0 py-2 font-mono text-sm tabular text-foreground",
          "placeholder:text-foreground/35 placeholder:uppercase placeholder:tracking-[0.08em]",
          "focus-visible:outline-none focus-visible:border-foreground",
          "disabled:cursor-not-allowed disabled:opacity-40",
          "file:border-0 file:bg-transparent file:font-mono file:text-xs file:uppercase file:tracking-[0.1em] file:text-foreground",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
