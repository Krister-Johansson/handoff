"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { createFollowUpAction } from "@/app/inbox/follow-up-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { SEVERITIES, type Finding, type Findings, type FollowUp } from "@/lib/findings";
import { cn } from "@/lib/utils";
import { CARD, PROSE_TIGHT } from "./styles";

const VERDICTS: Record<Findings["verdict"], string> = { approve: "approved", request_changes: "requested changes" };

const locationOf = (f: Finding) => (f.line !== undefined ? `${f.path}:${f.line}` : f.path);

/** A finding's first paragraph, for a one-line summary of a finding the diff shows in full. */
const firstParagraph = (body: string) => body.trim().split(/\n\s*\n/)[0] ?? "";

type Props = {
  findings: Findings;
  by: string;
  files: DiffFile[];
  open: (index: number) => void;
  runId: string;
  questionId: string;
  /** The issue already opened from these findings, if any. */
  followUp?: FollowUp | undefined;
};

/** One finding: a pick box for a follow-up issue, where it is, and its text. */
function FindingRow({ finding, at, picked, onPick, open }: { finding: Finding; at: number | undefined; picked?: boolean | undefined; onPick?: ((on: boolean) => void) | undefined; open: (index: number) => void }) {
  const where = locationOf(finding);
  return (
    <li className="flex items-start gap-2.5">
      {onPick && <Checkbox className="mt-0.5" aria-label={`Pick ${where} for a follow-up issue`} checked={picked} onCheckedChange={(on) => onPick(on === true)} />}
      <div className="flex min-w-0 flex-1 flex-col gap-x-2 gap-y-0.5 sm:flex-row sm:items-baseline">
        {at === undefined ? (
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{where}</span>
        ) : (
          <button type="button" className="shrink-0 text-left font-mono text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline" onClick={() => open(at)}>
            {where}
          </button>
        )}
        <div className={cn(PROSE_TIGHT, "min-w-0 flex-1", at !== undefined && "line-clamp-2")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{at === undefined ? finding.body : firstParagraph(finding.body)}</ReactMarkdown>
        </div>
      </div>
    </li>
  );
}

/** Which findings go into a follow-up issue: the follow-up ones to start with, then what the person picks. */
function useFollowUp(findings: Findings, runId: string, questionId: string, initial: FollowUp | undefined) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(findings.comments.flatMap((c, i) => (c.severity === "follow_up" ? [i] : []))));
  const [issue, setIssue] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const pick = (index: number, on: boolean) =>
    setPicked((set) => {
      const next = new Set(set);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  const create = () =>
    startTransition(async () => {
      const result = await createFollowUpAction({ runId, questionId, findings: [...picked].sort((a, b) => a - b) });
      startTransition(() => {
        if (result.ok) setIssue(result.issue);
        else setError(result.error);
      });
    });
  return { picked, pick, issue, error, pending, create };
}

/**
 * The code reviewing step's verdict and every finding with where it is, grouped by severity. A finding
 * on a file in the diff links to that file and shows its first paragraph, since the whole of it sits on
 * its line; a finding on a file outside the diff is shown in full here, the only place it appears. A
 * person picks findings to leave for later and opens one GitHub issue with them.
 */
export function FindingsSummary({ findings, by, files, open, runId, questionId, followUp }: Props) {
  const index = new Map(files.map((f, i) => [f.path, i]));
  const n = findings.comments.length;
  const inDiff = findings.comments.filter((c) => index.has(c.path)).length;
  const later = useFollowUp(findings, runId, questionId, followUp);
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
        {inDiff > 0 && <p className="mt-0.5 text-[13px] text-muted-foreground">Findings on files in the diff also sit on their lines below.</p>}
        {SEVERITIES.map(({ severity, title }) => {
          const group = numbered.filter(({ finding }) => (finding.severity ?? "should_fix") === severity);
          if (group.length === 0) return null;
          return (
            <section key={severity} aria-label={title} className="mt-3 flex flex-col gap-1.5">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {title}
                <Badge variant={severity === "blocking" ? "destructive" : "secondary"}>{group.length}</Badge>
              </h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {group.map(({ finding, i }) => (
                  <FindingRow
                    key={`${finding.path}:${finding.line}:${finding.body}`}
                    finding={finding}
                    at={index.get(finding.path)}
                    open={open}
                    {...(later.issue ? {} : { picked: later.picked.has(i), onPick: (on: boolean) => later.pick(i, on) })}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {n > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {later.issue ? (
              <span>
                Follow-up issue{" "}
                <a href={later.issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
                  {`#${later.issue.number}`}
                  <ExternalLinkIcon aria-hidden className="size-3" />
                </a>
              </span>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" disabled={later.picked.size === 0 || later.pending} onClick={later.create}>
                  {later.pending && <Spinner data-icon="inline-start" />}
                  Create follow-up issue
                </Button>
                <span>{`${later.picked.size} picked`}</span>
                {later.error && <span role="alert" className="text-danger">{later.error}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
