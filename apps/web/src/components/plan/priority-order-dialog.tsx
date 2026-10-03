"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ASKS = {
  drop: "Switch it to Project order to plan by dragging? The drop is saved after the switch, and the scheduler keeps its other settings.",
  optimize: "Switch it to Project order to optimize the order? Optimize shows its preview after the switch, and the scheduler keeps its other settings.",
};

/**
 * A drop or Optimize on the Flow while the scheduler orders by Priority (docs/plans/flow.md, Decision 3): the
 * order of the tasks does not decide what starts next, so it asks to switch to Project order. Switch saves the
 * scheduler's order and then the drop, or shows Optimize's preview; Cancel puts the card back or shows none.
 */
export function PriorityOrderDialog({
  open,
  asking = "drop",
  onSwitch,
  onCancel,
}: {
  open: boolean;
  asking?: keyof typeof ASKS;
  onSwitch: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>The scheduler starts tasks by Priority</DialogTitle>
          <DialogDescription>{ASKS[asking]}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSwitch}>Switch to Project order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
