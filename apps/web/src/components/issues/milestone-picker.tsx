"use client";

import { startTransition, useOptimistic, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, ChevronDownIcon, MilestoneIcon, XIcon } from "lucide-react";
import type { MilestoneRef } from "@handoff/github";
import { setMilestoneAction } from "@/app/projects/issue-actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { dueShort } from "@/lib/plan/milestone-text";
import type { ItemMilestone, PlanMilestone } from "@/lib/plan/milestones";
import { cn } from "@/lib/utils";
import { MilestoneNote } from "./milestone-note";

type Kind = "task" | "story" | "epic";

type Props = {
  projectId: string;
  issue: number;
  kind: Kind;
  /** The issue's own milestone, as GitHub has it. */
  own: MilestoneRef | null;
  /** The milestone it takes from its story or epic while it has none of its own. */
  inherited: ItemMilestone | undefined;
  /** The repository's milestones, open and closed, with their progress. */
  milestones: PlanMilestone[];
};

const fromText = (m: ItemMilestone) => (m.inherited ? `from ${m.inherited.kind} #${m.inherited.issue}` : undefined);

/** What a pick on an epic or a story leaves to the items under it; nothing for a task. */
const INHERITS: Record<Kind, string | undefined> = {
  task: undefined,
  story: "Its tasks without one of their own inherit it.",
  epic: "Its stories and tasks without one of their own inherit it.",
};

/**
 * The Milestone section's button and picker: the issue's own milestone, or the one it inherits shown with "from epic
 * #12", or No milestone. The picker lists the open milestones by due date, the closed ones under Closed (GitHub keeps
 * them, set_milestone refuses them), and Clear. A pick writes the issue's own milestone to GitHub at once, on this
 * issue alone, with a toast whose Undo writes back the milestone it had.
 */
export function MilestonePicker({ projectId, issue, kind, own, inherited, milestones }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [shown, show] = useOptimistic<{ own: MilestoneRef | null; saving: boolean }, MilestoneRef | null>({ own, saving: false }, (_, next) => ({ own: next, saving: true }));
  // A pick or a clear shows while it saves; otherwise the issue's own milestone, else the one it inherits.
  const current: ItemMilestone | undefined = shown.saving ? (shown.own ?? undefined) : (own ?? (inherited?.inherited ? inherited : undefined));

  /** Writes the milestone; `undoing` is set on Undo's write, which says where the issue is back and offers no Undo of its own. */
  const save = (to: MilestoneRef | null, undoing = false) => {
    setOpen(false);
    setError(undefined);
    startTransition(async () => {
      show(to);
      const result = await setMilestoneAction({ projectId, issue, milestone: to?.number ?? null });
      if (!result.ok) return setError(result.error);
      router.refresh();
      if (undoing) return void toast.success(`#${issue} is back in ${result.milestone?.title ?? "no milestone"}`);
      const back = result.from;
      toast.success(result.milestone ? `#${issue} is in ${result.milestone.title}` : `Cleared the milestone of #${issue}`, {
        ...(INHERITS[kind] ? { description: INHERITS[kind] } : {}),
        action: { label: "Undo", onClick: () => save(back, true) },
      });
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <PickerButton issue={issue} current={current} saving={shown.saving} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[300px] gap-0 p-0" aria-label={`Milestone of #${issue}`}>
          <MilestoneOptions milestones={milestones} current={current} clearable={own !== null} onPick={save} />
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {[`A pick sets the milestone on #${issue} only and saves to GitHub at once, with Undo.`, INHERITS[kind], "Create and close milestones on GitHub."].filter(Boolean).join(" ")}
          </p>
        </PopoverContent>
      </Popover>
      {current && <MilestoneNote milestone={milestones.find((m) => m.number === current.number)} />}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The milestone as a button: its title with "from epic #12" when inherited, dashed No milestone without one, a spinner while it saves. */
function PickerButton({ issue, current, saving, ...trigger }: { issue: number; current: ItemMilestone | undefined; saving: boolean } & ComponentProps<"button">) {
  const from = current && fromText(current);
  const name = current ? `Milestone ${current.title}${from ? `, ${from}` : ""}. Change the milestone of #${issue}` : `No milestone. Set the milestone of #${issue}`;
  return (
    <Button
      variant="outline"
      size="xs"
      {...trigger}
      aria-label={name}
      aria-busy={saving || undefined}
      className={cn("w-fit max-w-full", !current && "border-dashed font-normal text-muted-foreground")}
    >
      {saving ? <Spinner data-icon="inline-start" aria-hidden /> : <MilestoneIcon data-icon="inline-start" />}
      <span className="truncate">{current?.title ?? "No milestone"}</span>
      {from && <span className="font-normal text-muted-foreground">{from}</span>}
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );
}

/** One milestone in the picker: a check on the current one, "From epic #12" under an inherited one, and its due date. */
function MilestoneOption({ milestone, current, onPick }: { milestone: PlanMilestone; current: ItemMilestone | undefined; onPick?: (to: MilestoneRef) => void }) {
  const here = current?.number === milestone.number;
  const due = dueShort(milestone);
  return (
    <CommandItem value={`${milestone.title} #${milestone.number}`} disabled={!onPick} onSelect={() => onPick?.({ number: milestone.number, title: milestone.title })}>
      <span className="flex size-4 shrink-0 items-center">{here && <CheckIcon aria-label="Current milestone" />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{milestone.title}</span>
        {here && current?.inherited && (
          <span className="text-xs text-muted-foreground">
            From {current.inherited.kind} #{current.inherited.issue}
          </span>
        )}
      </span>
      {due && <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{due}</span>}
    </CommandItem>
  );
}

/** The open milestones to pick, the closed ones under Closed that cannot be picked, and Clear while the issue has one of its own. */
function MilestoneOptions({
  milestones,
  current,
  clearable,
  onPick,
}: {
  milestones: PlanMilestone[];
  current: ItemMilestone | undefined;
  clearable: boolean;
  onPick: (to: MilestoneRef | null) => void;
}) {
  const openOnes = milestones.filter((m) => m.state === "open");
  const closed = milestones.filter((m) => m.state === "closed");
  return (
    <Command>
      <CommandInput placeholder="Filter milestones" />
      <CommandList>
        <CommandEmpty>No milestone matches.</CommandEmpty>
        {openOnes.length > 0 && (
          <CommandGroup heading="Open">
            {openOnes.map((m) => (
              <MilestoneOption key={m.number} milestone={m} current={current} onPick={onPick} />
            ))}
          </CommandGroup>
        )}
        {closed.length > 0 && (
          <CommandGroup heading="Closed">
            {closed.map((m) => (
              <MilestoneOption key={m.number} milestone={m} current={current} />
            ))}
          </CommandGroup>
        )}
        {clearable && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="Clear the milestone" onSelect={() => onPick(null)}>
                <XIcon />
                Clear the milestone
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
}
