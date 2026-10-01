"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, ExternalLinkIcon, ListChecksIcon, RotateCwIcon } from "lucide-react";
import { answerReviewAction, restartTryItAction } from "@/app/inbox/actions";
import { Screenshot, type Shot } from "@/components/runs/screenshot";
import { Tag } from "@/components/tag";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CARD } from "./styles";

/** The run's app as the gate started it: its address while it runs, or why it did not start. */
export type TryPreview = { id?: string; url?: string; status: "running" | "failed"; error?: string };

/** A criterion's result: works, does not work (with what is wrong), or not checked yet. */
type Check = { works?: boolean; note: string };

type Answered = { option: string | null; comments: { quote?: string | undefined; body: string }[] };

type Props = {
  questionId: string;
  runId: string;
  /** The step that gets the work back when something does not work. */
  from: string;
  acceptance: string[];
  preview: TryPreview;
  shots: Shot[];
  answered?: Answered | undefined;
};

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const sectionId = (index: number) => `try-criterion-${index}`;

/** Moves between criteria with prev and next, the [ and ] keys, and the list of every criterion. */
function useCursor(count: number) {
  const [current, setCurrent] = useState(0);
  const go = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(count - 1, index));
      setCurrent(next);
      document.getElementById(sectionId(next))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    },
    [count],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "]") go(current + 1);
      if (e.key === "[") go(current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go]);
  return [current, go] as const;
}

/** The checks an answered review settled: what came back as a comment did not work; the rest did. */
function answeredChecks(acceptance: string[], answered: Answered | undefined): Check[] {
  return acceptance.map((criterion) => {
    if (!answered) return { note: "" };
    const failed = answered.comments.find((c) => c.quote === criterion);
    return failed ? { works: false, note: failed.body } : { works: answered.option === "approve" || answered.comments.length > 0 ? true : undefined, note: "" };
  });
}

/** The run's app: open it while it runs, see why it did not start, or start it again. */
function AppBar({ preview, readOnly, questionId, runId }: { preview: TryPreview; readOnly: boolean; questionId: string; runId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section aria-label="The app" className={cn(CARD, "flex flex-col gap-3 px-5 py-4")}>
      <div className="flex flex-wrap items-center gap-2">
        {preview.status === "running" && preview.url ? (
          <Button asChild size="sm">
            <a href={preview.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Open the app
              <span className="font-mono text-xs opacity-80">{preview.url.replace(/^https?:\/\//, "")}</span>
            </a>
          </Button>
        ) : (
          <span className="text-sm font-medium">The app is not running.</span>
        )}
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await restartTryItAction({ questionId, runId });
                setError(result.ok ? undefined : result.error);
              })
            }
          >
            <RotateCwIcon data-icon="inline-start" />
            Start the app again
          </Button>
        )}
      </div>
      {preview.status === "failed" && <TerminalOutput text={preview.error ?? "The app did not start."} />}
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}

/** The toolbar's list of criteria, each checked off once it works. */
function CriterionMenu({ acceptance, checks, current, go }: { acceptance: string[]; checks: Check[]; current: number; go: (index: number) => void }) {
  const checked = checks.filter((c) => c.works !== undefined).length;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-w-0">
            <ListChecksIcon data-icon="inline-start" />
            <span className="max-w-[min(22rem,40vw)] truncate">{acceptance[current]}</span>{" "}
            <span className="text-muted-foreground">{`${current + 1} of ${acceptance.length}`}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
          <div className="max-h-80 overflow-y-auto p-1.5">
            {acceptance.map((criterion, index) => (
              <DropdownMenuItem key={criterion} onSelect={() => go(index)} className={cn("gap-2.5 text-xs", index === current && "bg-accent")}>
                <CheckIcon className={checks[index]?.works === true ? "text-success" : "invisible"} />
                <span className="min-w-0 flex-1 truncate">{criterion}</span>
                {checks[index]?.works === false && <span className="text-danger">does not work</span>}
              </DropdownMenuItem>
            ))}
          </div>
          <div className="flex justify-between gap-4 border-t px-3.5 py-2 text-xs text-muted-foreground">
            <span>{`${checked} of ${acceptance.length} checked`}</span>
            <span>[ and ] move between criteria</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous criterion" disabled={current === 0} onClick={() => go(current - 1)}>
        <ChevronLeftIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Next criterion" disabled={current === acceptance.length - 1} onClick={() => go(current + 1)}>
        <ChevronRightIcon />
      </Button>
    </>
  );
}

/** One acceptance criterion: a header to open or close it with its result, and its screenshots and what is wrong. */
function Criterion({
  index,
  criterion,
  check,
  open,
  shots,
  readOnly,
  onToggle,
  onWorks,
  onNote,
}: {
  index: number;
  criterion: string;
  check: Check;
  open: boolean;
  shots: Shot[];
  readOnly: boolean;
  onToggle: () => void;
  onWorks: (works: boolean | undefined) => void;
  onNote: (note: string) => void;
}) {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  const checkId = `try-works-${index}`;
  return (
    <section id={sectionId(index)} aria-label={criterion} className="scroll-mt-[120px] overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-2.5 bg-subtle px-3 py-2 text-sm">
        <Button type="button" size="icon-xs" variant="ghost" className="-ml-1 text-muted-foreground" aria-label={`${open ? "Collapse" : "Expand"} ${criterion}`} aria-expanded={open} onClick={onToggle}>
          <Chevron />
        </Button>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{index + 1}</span>
        <span className={cn("min-w-0 flex-1", check.works === true && "text-muted-foreground")}>{criterion}</span>
        {readOnly ? (
          check.works !== undefined && <Tag tone={check.works ? "success" : "danger"}>{check.works ? "Works" : "Doesn't work"}</Tag>
        ) : (
          <span className="ml-auto flex items-center gap-3">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className={cn(check.works === false && "border-danger text-danger")}
              aria-pressed={check.works === false}
              onClick={() => onWorks(check.works === false ? undefined : false)}
            >
              Doesn&apos;t work
            </Button>
            <span className="flex items-center gap-1.5">
              <Checkbox id={checkId} checked={check.works === true} onCheckedChange={(checked) => onWorks(checked === true ? true : undefined)} className="size-[15px]" />
              <Label htmlFor={checkId} className="text-xs font-normal text-muted-foreground">
                Works
              </Label>
            </span>
          </span>
        )}
      </header>
      {open && (
        <div className="flex flex-col gap-3 border-t px-4 py-3">
          {check.works === false &&
            (readOnly ? (
              <p className="text-sm whitespace-pre-wrap">{check.note}</p>
            ) : (
              <Field>
                <FieldLabel htmlFor={`try-note-${index}`}>What is wrong?</FieldLabel>
                <Textarea id={`try-note-${index}`} rows={2} value={check.note} onChange={(e) => onNote(e.target.value)} placeholder="What you did, and what happened instead." />
              </Field>
            ))}
          {shots.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {shots.map((shot) => (
                <Screenshot key={shot.id} shot={shot} showCriterion={false} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">No screenshot shows this one; check it in the app.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Approve when every criterion works, or send back what does not, with an overall note. */
function Submit({ from, checks, acceptance, questionId, runId }: { from: string; checks: Check[]; acceptance: string[]; questionId: string; runId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const failed = acceptance.flatMap((quote, i) => (checks[i]?.works === false ? [{ quote, body: checks[i]!.note.trim() || "Does not work." }] : []));
  const allWork = checks.every((c) => c.works === true);
  const answer = (option: "approve" | "changes") =>
    start(async () => {
      const result = await answerReviewAction({ questionId, runId, option, note: note.trim(), comments: option === "changes" ? failed : [] });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" className="ml-auto">
          Submit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[min(25rem,calc(100vw-2rem))] flex-col gap-3">
        <PopoverHeader>
          <PopoverTitle>Submit</PopoverTitle>
          <PopoverDescription>
            {failed.length ? `${failed.length} ${failed.length === 1 ? "criterion does" : "criteria do"} not work; they go back to ${from}.` : allWork ? "Every criterion works." : "Check every criterion to approve."}
          </PopoverDescription>
        </PopoverHeader>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`try-overall-${questionId}`}>Note (optional)</FieldLabel>
          <Textarea id={`try-overall-${questionId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else the coder should know." />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending || (failed.length === 0 && !note.trim())} onClick={() => answer("changes")}>
            {`Send back to ${from}`}
          </Button>
          <Button type="button" disabled={pending || !allWork} onClick={() => answer("approve")}>
            Approve
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A Try it gate's review, laid out like a code review: the app to open, a toolbar to step through the
 * acceptance criteria, and one section per criterion with its screenshots. Marking a criterion as
 * working collapses it and moves on to the next one to check; one that does not work stays open for
 * what is wrong, which goes back to the coder.
 */
export function TryReview({ questionId, runId, from, acceptance, preview, shots, answered }: Props) {
  const readOnly = answered !== undefined;
  const [checks, setChecks] = useState<Check[]>(() => answeredChecks(acceptance, answered));
  const [closed, setClosed] = useState<ReadonlySet<number>>(() => new Set(checks.flatMap((c, i) => (c.works === true ? [i] : []))));
  const [current, go] = useCursor(acceptance.length);
  const checked = checks.filter((c) => c.works !== undefined).length;
  const criteria = new Set(acceptance);
  const loose = shots.filter((s) => !s.criterion || !criteria.has(s.criterion));

  const setOpen = (index: number, open: boolean) =>
    setClosed((set) => {
      const next = new Set(set);
      if (open) next.delete(index);
      else next.add(index);
      return next;
    });
  const mark = (index: number, works: boolean | undefined) => {
    const next = checks.map((c, i) => (i === index ? { ...c, works } : c));
    setChecks(next);
    setOpen(index, works !== true);
    if (works === true) {
      // On to the next criterion still to check, after this one first.
      const after = next.findIndex((c, i) => i > index && c.works === undefined);
      const anywhere = next.findIndex((c) => c.works === undefined);
      const to = after >= 0 ? after : anywhere;
      if (to >= 0) go(to);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AppBar preview={preview} readOnly={readOnly} questionId={questionId} runId={runId} />
      {acceptance.length > 0 && (
        <div className="sticky top-[60px] z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 backdrop-blur-md">
          <CriterionMenu acceptance={acceptance} checks={checks} current={current} go={go} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse all criteria" onClick={() => setClosed(new Set(acceptance.map((_, i) => i)))}>
            <ChevronsDownUpIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Expand all criteria" onClick={() => setClosed(new Set())}>
            <ChevronsUpDownIcon />
          </Button>
          <span className={cn("text-xs text-muted-foreground", readOnly && "ml-auto")}>{`${checked} of ${acceptance.length} checked`}</span>
          {!readOnly && <Submit from={from} checks={checks} acceptance={acceptance} questionId={questionId} runId={runId} />}
        </div>
      )}
      {acceptance.length === 0 && !readOnly && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">This run has no acceptance criteria. Try the app, then approve it or send it back with a note.</p>
          <Submit from={from} checks={checks} acceptance={acceptance} questionId={questionId} runId={runId} />
        </div>
      )}
      {acceptance.map((criterion, index) => (
        <Criterion
          key={criterion}
          index={index}
          criterion={criterion}
          check={checks[index]!}
          open={!closed.has(index)}
          shots={shots.filter((s) => s.criterion === criterion)}
          readOnly={readOnly}
          onToggle={() => setOpen(index, closed.has(index))}
          onWorks={(works) => mark(index, works)}
          onNote={(note) => setChecks((all) => all.map((c, i) => (i === index ? { ...c, note } : c)))}
        />
      ))}
      {loose.length > 0 && (
        <section aria-label="Other screenshots" className={cn(CARD, "flex flex-col gap-3 px-4 py-3")}>
          <h2 className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">Other screenshots</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {loose.map((shot) => (
              <Screenshot key={shot.id} shot={shot} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
