// ABOUTME: Badge component for status and state indicators.
// ABOUTME: Uses shadcn chart colors for visual distinction.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        // Task status variants using chart colors
        idle: "bg-chart-2/15 text-chart-2",
        working: "bg-chart-1/15 text-chart-1",
        starting: "bg-chart-3/15 text-chart-3",
        // Linear state variants using muted colors
        planning: "bg-muted text-muted-foreground",
        building: "bg-chart-1/15 text-chart-1",
        feedback: "bg-chart-3/15 text-chart-3",
        review: "bg-muted text-muted-foreground",
        done: "bg-chart-2/15 text-chart-2",
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
