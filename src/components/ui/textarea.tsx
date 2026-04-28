import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[100px] w-full border-0 border-b border-foreground/40 bg-transparent px-0 py-2 font-body text-base leading-relaxed text-foreground",
        "placeholder:text-foreground/35",
        "focus-visible:outline-none focus-visible:border-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "resize-none",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
