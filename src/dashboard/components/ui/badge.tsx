// ABOUTME: Badge component for status and state indicators.
// ABOUTME: Supports status (idle/working/starting) and Linear state variants.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        // Task status variants
        idle: "bg-status-idle/15 text-status-idle",
        working: "bg-status-working/15 text-status-working",
        starting: "bg-status-starting/15 text-status-starting",
        // Linear state variants
        planning: "bg-state-planning/20 text-state-planning",
        building: "bg-state-building/20 text-state-building",
        feedback: "bg-state-feedback/20 text-state-feedback",
        review: "bg-state-review/20 text-state-review",
        done: "bg-state-done/20 text-state-done",
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
