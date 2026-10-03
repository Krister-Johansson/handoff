"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BotIcon, CircleDotIcon, ExternalLinkIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { createFollowUpAction } from "@/app/inbox/follow-up-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CHOICES, locationOf, SEVERITIES, type Choice, type Finding, type Findings, type FollowUp } from "@/lib/findings";
import { cn } from "@/lib/utils";
import { countOf } from "./send-review";
import { CARD, PROSE_TIGHT } from "./styles";

const VERDICTS: Record<Findings["verdict"], string> = { approve: "approved", request_changes: "requested changes" };

/** A finding's first paragraph, for a one-line summary of a finding the diff shows in full. */
const firstParagraph = (body: string) => body.trim().split(/\n\s*\n/)[0] ?? "";

/** Each choice's colour once picked: Fix now is work for the coder, Follow-up waits, Skip is grey. */
const PICKED: Record<Choice, string> = {
  fix_now: "data-[state=on]:bg-attention-bg data-[state=on]:text-attention",
  follow_up: "data-[state=on]:bg-active-bg data-[state=on]:text-active",
  skip: "data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground",
};

/** The tally's dot for each choice. */
const DOTS: Record<Choice, string> = { fix_now: "bg-attention-dot", follow_up: "bg-active-dot", skip: "bg-muted-foreground/60" };

type Props = {
  findings: Findings;
  by: string;
  files: DiffFile[];
  open: (index: number) => void;
  runId: string;
  questionId: string;
  /** Where the Fix now findings go when the review is sent. */
  target: string;
  /** Every finding's choice, by its place in the review. */
  choices: Choice[];
  choose: (index: number, choice: Choice) => void;
  /** The review was sent: the choices only decide what a follow-up issue takes. */
  answered?: boolean | undefined;
  /** The issue already opened from these findings, if any. */
  followUp?: FollowUp | undefined;
  /** Called with the issue once the person opens one. */
  onFollowUp?: ((issue: FollowUp) => void) | undefined;
};

/** One finding's choice: Fix now, Follow-up or Skip, as one segmented control. */
function ChoiceControl({ where, choice, choose }: { where: string; choice: Choice; choose: (choice: Choice) => void }) {
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      spacing={0.5}
      value={choice}
      onValueChange={(value) => value && choose(value as Choice)}
      aria-label={`What to do with ${where}`}
      className="shrink-0 rounded-md border bg-subtle p-0.5"
    >
      {CHOICES.map(({ choice: value, title }) => (
        <ToggleGroupItem key={value} value={value} className={cn("h-[22px] min-w-0 rounded-[4px] px-2 text-[11.5px] font-medium text-muted-foreground hover:bg-transparent", PICKED[value])}>
          {title}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A finding: where it is, its text, and what the person does with it, or the issue that holds it. */
function FindingRow({ finding, at, choice, choose, issue, open }: { finding: Finding; at: number | undefined; choice: Choice; choose: (choice: Choice) => void; issue: FollowUp | undefined; open: (index: number) => void }) {
  const where = locationOf(finding);
  const skipped = choice === "skip" && !issue;
  return (
    <li className="-mx-2 flex flex-col gap-2 rounded-md px-2 py-1.5 hover:bg-subtle sm:flex-row sm:items-start sm:gap-4">
      <div className={cn("flex min-w-0 flex-1 flex-col gap-x-2 gap-y-0.5 sm:flex-row sm:items-baseline", skipped && "text-muted-foreground line-through decoration-muted-foreground/60")}>
        {at === undefined ? (
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{where}</span>
        ) : (
          <button type="button" className="shrink-0 text-left font-mono text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline" onClick={() => open(at)}>
            {where}
          </button>
        )}
        <div className={cn(PROSE_TIGHT, "min-w-0 flex-1", at !== undefined && "line-clamp-2", skipped && "text-muted-foreground")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{at === undefined ? finding.body : firstParagraph(finding.body)}</ReactMarkdown>
        </div>
      </div>
      {issue ? (
        <span className="inline-flex h-[22px] shrink-0 items-center gap-1 self-start rounded-[4px] bg-active-bg px-2 text-[11.5px] font-medium text-active">
          <CircleDotIcon aria-hidden className="size-3" />
          {`In #${issue.number}`}
        </span>
      ) : (
        <ChoiceControl where={where} choice={choice} choose={choose} />
      )}
    </li>
  );
}

/** The follow-up issue for the Follow-up findings: the one opened before, or the one the person opens here. */
function useFollowUp(runId: string, questionId: string, initial: FollowUp | undefined, onFollowUp: ((issue: FollowUp) => void) | undefined) {
  const [issue, setIssue] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const create = (findings: number[]) =>
    startTransition(async () => {
      const result = await createFollowUpAction({ runId, questionId, findings });
      startTransition(() => {
        if (result.ok) {
          const opened = { ...result.issue, findings };
          setIssue(opened);
          onFollowUp?.(opened);
        } else setError(result.error);
      });
    });
  return { issue, error, pending, create };
}

/** How many findings have each choice. */
function Tally({ choices }: { choices: Choice[] }) {
  return (
    <ul aria-label="Choices" className="flex gap-3 sm:ml-auto">
      {CHOICES.map(({ choice, title }) => (
        <li key={choice} className="inline-flex items-center gap-1.5">
          <i aria-hidden className={cn("inline-block size-[7px] rounded-full", DOTS[choice])} />
          {title} <b className="font-semibold text-foreground tabular-nums">{choices.filter((c) => c === choice).length}</b>
        </li>
      ))}
    </ul>
  );
}

/** Under the heading: that findings also sit on their lines, and where Fix now findings go while the review is open. */
function Subtitle({ inDiff, target }: { inDiff: boolean; target: string | undefined }) {
  const text = [inDiff ? "Findings on files in the diff also sit on their lines below." : "", target ? `Fix now findings go back to ${target} when you send the review.` : ""].filter(Boolean).join(" ");
  return text ? <p className="mt-0.5 text-[13px] text-muted-foreground">{text}</p> : null;
}

/** The footer: Create follow-up issue with the Follow-up findings, or the issue they went into, and the tally. */
function Footer({ later, forIssue, choices }: { later: ReturnType<typeof useFollowUp>; forIssue: number[]; choices: Choice[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t pt-2.5 text-xs text-muted-foreground">
      {later.issue ? (
        <span>
          Follow-up issue{" "}
          <a href={later.issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
            {`#${later.issue.number}`}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
          {later.issue.findings ? ` has the ${countOf(later.issue.findings.length, "Follow-up finding")}.` : null}
        </span>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" disabled={forIssue.length === 0 || later.pending} onClick={() => later.create(forIssue)}>
            {later.pending && <Spinner data-icon="inline-start" />}
            Create follow-up issue
          </Button>
          <span>{`Takes the ${countOf(forIssue.length, "Follow-up finding")}.`}</span>
          {later.error && <span role="alert" className="text-danger">{later.error}</span>}
        </>
      )}
      <Tally choices={choices} />
    </div>
  );
}

/**
 * The code reviewing step's verdict and every finding with where it is, grouped by severity. A finding
 * on a file in the diff links to that file and shows its first paragraph, since the whole of it sits on
 * its line; a finding on a file outside the diff is shown in full here, the only place it appears. The
 * person picks what to do with each finding: Fix now goes back to the coder with the review, Follow-up
 * goes into one GitHub issue, Skip drops it.
 */
export function FindingsSummary({ findings, by, files, open, runId, questionId, target, choices, choose, answered, followUp, onFollowUp }: Props) {
  const index = new Map(files.map((f, i) => [f.path, i]));
  const n = findings.comments.length;
  const inDiff = findings.comments.filter((c) => index.has(c.path)).length;
  const later = useFollowUp(runId, questionId, followUp, onFollowUp);
  const inIssue = new Set(later.issue?.findings ?? []);
  const forIssue = choices.flatMap((choice, i) => (choice === "follow_up" ? [i] : []));
  const numbered = findings.comments.map((finding, i) => ({ finding, i }));
  return (
    <section aria-label="Code review findings" className={cn(CARD, "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 px-[18px] py-3.5")}>
      <span className="grid size-8 place-items-center rounded-md bg-active-bg text-active">
        <BotIcon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold">{n === 0 ? "Code review found nothing" : `Code review found ${n} ${n === 1 ? "thing" : "things"}`}</h2>
          <span className="text-xs text-muted-foreground">{`· ${by} · ${VERDICTS[findings.verdict]}${n > 0 ? ` · ${inDiff} in the diff` : ""}`}</span>
        </div>
        {n > 0 && <Subtitle inDiff={inDiff > 0} target={answered ? undefined : target} />}
        {SEVERITIES.map(({ severity, title }) => {
          const group = numbered.filter(({ finding }) => (finding.severity ?? "should_fix") === severity);
          if (group.length === 0) return null;
          return (
            <section key={severity} aria-label={title} className="mt-3 flex flex-col gap-0.5">
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {title}
                <Badge variant={severity === "blocking" ? "destructive" : "secondary"}>{group.length}</Badge>
              </h3>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {group.map(({ finding, i }) => (
                  <FindingRow
                    key={`${finding.path}:${finding.line}:${finding.body}`}
                    finding={finding}
                    at={index.get(finding.path)}
                    choice={choices[i]!}
                    choose={(choice) => choose(i, choice)}
                    issue={inIssue.has(i) ? later.issue : undefined}
                    open={open}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {n > 0 && <Footer later={later} forIssue={forIssue} choices={choices} />}
      </div>
    </section>
  );
}
