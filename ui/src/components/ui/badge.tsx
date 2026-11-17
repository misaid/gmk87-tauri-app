import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "readout inline-flex items-center rounded-[var(--r-ctl)] border px-2 py-0.5 text-[11px]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--text)] text-[var(--cap-ink)]",
        secondary: "border-transparent bg-[var(--bg-raise-2)] text-[var(--muted)]",
        outline: "border-[var(--line-strong)] text-[var(--muted)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
