"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * A drop on the Flow while the scheduler orders by Priority (docs/plans/flow.md, Decision 3): the order of the
 * tasks does not decide what starts next, so the drop asks to switch to Project order. Switch saves the
 * scheduler's order and then the drop; Cancel puts the card back.
 */
export function PriorityOrderDialog({ open, onSwitch, onCancel }: { open: boolean; onSwitch: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>The scheduler starts tasks by Priority</DialogTitle>
          <DialogDescription>Switch it to Project order to plan by dragging? The drop is saved after the switch, and the scheduler keeps its other settings.</DialogDescription>
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
