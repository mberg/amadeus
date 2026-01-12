// ABOUTME: Badge component for status and state indicators.
// ABOUTME: Uses neutral shadcn colors for visual distinction.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        // Task status variants
        idle: "border-transparent bg-secondary text-secondary-foreground",
        working: "border-transparent bg-primary text-primary-foreground",
        starting: "border-border bg-transparent text-muted-foreground",
        // Linear state variants
        planning: "border-border bg-transparent text-muted-foreground",
        building: "border-transparent bg-primary text-primary-foreground",
        feedback: "border-border bg-secondary text-secondary-foreground",
        review: "border-border bg-secondary text-secondary-foreground",
        done: "border-transparent bg-muted text-muted-foreground",
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
