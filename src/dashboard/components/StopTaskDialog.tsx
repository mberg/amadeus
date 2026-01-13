// ABOUTME: Confirmation dialog for stopping a running task.
// ABOUTME: Displays task identifier and warns about consequences before stopping.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

interface StopTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskIdentifier: string;
  onConfirm: () => void;
}

export function StopTaskDialog({
  open,
  onOpenChange,
  taskIdentifier,
  onConfirm,
}: StopTaskDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop task {taskIdentifier}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will terminate the running task and remove its worktree. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={onConfirm}
          >
            Stop Task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
