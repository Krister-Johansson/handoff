"use client";

import { useState, useTransition } from "react";
import { InfoIcon, LockIcon } from "lucide-react";
import { scheduleAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { shortDay } from "@/lib/plan/timeline-scale";

/** The item a person schedules: its number, title and the dates GitHub holds now. */
export type ScheduleTarget = { number: number; title: string; start?: string | undefined; target?: string | undefined };

/** A line under the fields: the parent's window, or a blocker and when it is planned to end. */
export type ScheduleNote = { kind: "window" | "blocker"; text: string };

function DateField({ id, label, value, was, invalid, onChange }: { id: string; label: string; value: string; was: string | undefined; invalid?: boolean; onChange: (value: string) => void }) {
  return (
    <Field data-invalid={invalid || undefined} className="min-w-0 gap-1.5">
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Button type="button" variant="link" size="xs" className="h-auto px-0 text-muted-foreground" aria-label={`Clear ${label}`} disabled={value === ""} onClick={() => onChange("")}>
          Clear
        </Button>
      </div>
      <Input id={id} type="date" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldDescription className="text-xs">{was ? `Was ${shortDay(was)}` : "Was not set"}</FieldDescription>
    </Field>
  );
}

/**
 * Sets an item's Start and Target on the plan's GitHub Project: both prefilled with what GitHub holds,
 * each clearable, saved only when Target is on or after Start. Saving revalidates the page.
 */
export function ScheduleDialog({
  projectId,
  item,
  notes = [],
  onOpenChange,
}: {
  projectId: string;
  /** The item to schedule; undefined keeps the dialog closed. */
  item: ScheduleTarget | undefined;
  notes?: ScheduleNote[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={item !== undefined} onOpenChange={onOpenChange}>
      {item && (
        <DialogContent className="sm:max-w-md">
          <ScheduleForm key={item.number} projectId={projectId} item={item} notes={notes} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ScheduleForm({ projectId, item, notes, onDone }: { projectId: string; item: ScheduleTarget; notes: ScheduleNote[]; onDone: () => void }) {
  const [start, setStart] = useState(item.start ?? "");
  const [target, setTarget] = useState(item.target ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const backwards = start !== "" && target !== "" && target < start;
  const save = () =>
    startTransition(async () => {
      const result = await scheduleAction({ projectId, issue: item.number, start: start || null, target: target || null });
      if (result.ok) onDone();
      else setError(result.error ?? "GitHub did not take the dates.");
    });
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Schedule #{item.number} {item.title}
        </DialogTitle>
        <DialogDescription>Start and Target are saved on the GitHub Project, where its roadmap shows them too.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-3">
        <div className="grid grid-cols-2 gap-3">
          <DateField id={`schedule-start-${item.number}`} label="Start" value={start} was={item.start} onChange={setStart} />
          <DateField id={`schedule-target-${item.number}`} label="Target" value={target} was={item.target} invalid={backwards} onChange={setTarget} />
        </div>
        {backwards && <FieldError>Target must be on or after Start.</FieldError>}
        {notes.map((note) => (
          <p key={note.text} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            {note.kind === "window" ? <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" /> : <LockIcon aria-hidden className="mt-px size-3.5 shrink-0" />}
            {note.text}
          </p>
        ))}
        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button disabled={backwards || pending} onClick={save}>
          Save to GitHub
        </Button>
      </DialogFooter>
    </>
  );
}
