import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native <select>, styled explicitly: without `appearance-none` and an
 * authored background, some WebKit builds (including the Tauri webview) fall
 * back to the OS's native light control chrome regardless of our dark theme,
 * leaving light text on a near-white box.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-white/15 bg-neutral-900 px-2 pr-8 text-white",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-white/70" />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
