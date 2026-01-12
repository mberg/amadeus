// ABOUTME: Badge component for status and state indicators.
// ABOUTME: Uses subtle colors for minimal visual noise.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-muted-foreground",
        idle: "bg-secondary text-muted-foreground",
        working: "bg-chart-1/15 text-chart-1",
        starting: "bg-chart-3/15 text-chart-3",
        planning: "bg-status-planning/15 text-status-planning",
        building: "bg-status-building/15 text-status-building",
        feedback: "bg-status-feedback/15 text-status-feedback",
        review: "bg-status-review/15 text-status-review",
        done: "bg-status-done/15 text-status-done",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
