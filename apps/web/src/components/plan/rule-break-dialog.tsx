"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { afterBlockers, blockersFirst, carryDependents, keepPins, moveTo, type Blockers, type Blocks } from "@/lib/plan/flow-order";
import { cn } from "@/lib/utils";

/** A drop before an open blocker: the queue it was dropped into, where, and the blockers it now sits before. */
export type RuleBreakDrop = {
  issue: number;
  /** The queue before the drop. */
  queue: number[];
  /** The 0-based place the card was dropped at. */
  index: number;
  /** The open blockers in the queue the card now sits before, in queue order. */
  waitsFor: number[];
  pins: ReadonlySet<number>;
  blockers: Blockers;
  blocks: Blocks;
};

export type BreakChoice = "next" | "earlier" | "keep";

const issues = (list: readonly number[]) => {
  const named = list.map((n) => `#${n}`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};
const places = (list: readonly number[]) => issues(list).replaceAll("#", "Next ");

/**
 * The queue a choice gives (docs/plans/flow.md, Decision 10): Move to the next free slot puts the task right after
 * its last blocker, Move #61 earlier too moves its blockers to just before it, and Keep it here leaves it where it
 * was dropped. With `carry` the tasks that wait on it move to right after it. Every other pinned task then goes
 * back to its place number.
 */
function choiceQueue(drop: RuleBreakDrop, choice: BreakChoice, carry: boolean): number[] {
  const { issue, queue, index, blockers, blocks } = drop;
  const pins = new Set([...drop.pins].filter((n) => n !== issue));
  const dropped = moveTo(queue, issue, index);
  const base = choice === "next" ? afterBlockers(dropped, issue, blockers) : choice === "earlier" ? blockersFirst(queue, issue, index, blockers) : dropped;
  return keepPins(queue, carry ? carryDependents(base, issue, blocks, pins) : base, pins);
}

/** What each choice says it does, with the place numbers it gives. */
function choiceText(drop: RuleBreakDrop, choice: BreakChoice, carry: boolean): string {
  const { issue, waitsFor } = drop;
  const next = choiceQueue(drop, choice, carry);
  const place = next.indexOf(issue) + 1;
  if (choice === "next") return `Right after ${issues(waitsFor.slice(-1))}, as Next ${place}.`;
  if (choice === "keep") return `Pinned at Next ${place} with the warning Waits for ${waitsFor.map((n) => `#${n}`).join(", ")}. It still starts after ${issues(waitsFor)} ${waitsFor.length === 1 ? "ends" : "end"}.`;
  // The blockers that moved to just before the task, and the task, by their new places.
  const dropped = moveTo(drop.queue, issue, drop.index);
  const moved = next.filter((n) => n === issue || (dropped.indexOf(n) > dropped.indexOf(issue) && next.indexOf(n) < next.indexOf(issue)));
  const free = moved.length === 2 && (drop.blockers.get(moved[0]!) ?? []).length === 0 ? ` Nothing blocks #${moved[0]}.` : "";
  return `${issues(moved)} become ${places(moved.map((n) => next.indexOf(n) + 1))}.${free}`;
}

/**
 * "#62 can't start before #61": a drop before an open blocker asks where the task goes, with Move to the next free
 * slot picked and "Move the tasks that wait on #62 with it" on. Move hands the queue of the choice to `onMove`.
 */
export function RuleBreakDialog({
  drop,
  titleOf,
  onMove,
  onCancel,
}: {
  /** The drop that broke the rule; undefined keeps the dialog closed. */
  drop: RuleBreakDrop | undefined;
  titleOf: (issue: number) => string | undefined;
  onMove: (queue: number[], choice: BreakChoice) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={drop !== undefined} onOpenChange={(open) => !open && onCancel()}>
      {drop && (
        <DialogContent className="sm:max-w-[460px]">
          <Choices key={`${drop.issue}-${drop.index}`} drop={drop} titleOf={titleOf} onMove={onMove} onCancel={onCancel} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Choices({ drop, titleOf, onMove, onCancel }: { drop: RuleBreakDrop; titleOf: (issue: number) => string | undefined; onMove: (queue: number[], choice: BreakChoice) => void; onCancel: () => void }) {
  const id = useId();
  const [choice, setChoice] = useState<BreakChoice>("next");
  const [carry, setCarry] = useState(true);
  const { issue, waitsFor } = drop;
  const named = waitsFor.map((n) => `#${n}${titleOf(n) ? ` ${titleOf(n)}` : ""}`);
  const options: { value: BreakChoice; label: string }[] = [
    { value: "next", label: "Move to the next free slot" },
    { value: "earlier", label: `Move ${issues(waitsFor)} earlier too` },
    { value: "keep", label: "Keep it here" },
  ];
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          #{issue} can&apos;t start before {issues(waitsFor)}
        </DialogTitle>
        <DialogDescription>
          {named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`} {waitsFor.length === 1 ? "blocks" : "block"} it.
        </DialogDescription>
      </DialogHeader>
      <RadioGroup value={choice} onValueChange={(value) => setChoice(value as BreakChoice)} aria-label={`Where #${issue} goes`} className="gap-0.5 rounded-lg border p-1">
        {options.map((o) => (
          <label key={o.value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50", choice === o.value && "bg-muted")}>
            <RadioGroupItem value={o.value} aria-label={o.label} aria-describedby={`${id}-${o.value}`} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-medium">{o.label}</span>
              <span id={`${id}-${o.value}`} className="text-xs leading-snug text-muted-foreground">
                {choiceText(drop, o.value, carry)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <label className="flex cursor-pointer items-start gap-2.5 px-1">
        <Checkbox checked={carry} onCheckedChange={(on) => setCarry(on === true)} aria-labelledby={`${id}-carry-label`} aria-describedby={`${id}-carry`} className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span id={`${id}-carry-label`} className="text-[13.5px] font-medium">
            Move the tasks that wait on #{issue} with it
          </span>
          <span id={`${id}-carry`} className="text-xs leading-snug text-muted-foreground">
            Turn it off to move only #{issue}. The tasks after it may get warnings.
          </span>
        </span>
      </label>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onMove(choiceQueue(drop, choice, carry), choice)}>Move</Button>
      </DialogFooter>
    </>
  );
}
