"use client";

import type { ReactNode } from "react";
import { BotIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, GitCommitHorizontalIcon, GitPullRequestIcon, MessagesSquareIcon, ReplyIcon, UserRoundIcon } from "lucide-react";
import { Clock } from "@/components/clock";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Tag } from "@/components/tag";
import type { StatusTone } from "@/lib/status";
import { useReviewFold } from "@/lib/review-fold";
import { groupsOf, itemPlace, KIND_TAGS, resolvedHow, reviewSummary, splitComment, tallyOf, verdictCounts, VERDICTS, type ReviewItemView, type ReviewVerdict } from "@/lib/review-items";
import { reviewerName } from "@/lib/reviewers";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

export function VerdictTag({ verdict }: { verdict: ReviewVerdict }) {
  return <Tag className={VERDICTS[verdict].className}>{VERDICTS[verdict].label}</Tag>;
}

/** Whose review an answered thread waits for, since when, and when handoff asks a person. */
function WaitDetail({ item }: { item: ReviewItemView }) {
  return (
    <>
      {reviewerName(item.reviewer)}
      {item.repliedAt && (
        <>
          , since <Clock at={item.repliedAt} />
        </>
      )}
      {item.waitUntil && (
        <>
          , asks you at <Clock at={item.waitUntil} />
        </>
      )}
    </>
  );
}

function ResolvedDetail({ item }: { item: ReviewItemView }) {
  return (
    <>
      {resolvedHow(item.resolvedBy)}
      {item.resolvedAt && (
        <>
          , <Clock at={item.resolvedAt} />
        </>
      )}
    </>
  );
}

/** An item waiting on its reviewer: for its next review, for the next summary, or for a person to resolve what handoff could not. */
function awaitingStatus(item: ReviewItemView): { tone: StatusTone; label: string; detail: ReactNode } {
  const summaryItem = item.kind === "summary_note" || item.kind === "pre_merge_check";
  if (summaryItem) return { tone: "active", label: "waiting for summary", detail: `${reviewerName(item.reviewer)}'s next summary` };
  if (item.stateReason) return { tone: "attention", label: "resolve on GitHub", detail: "handoff cannot resolve it; the merge step lists it" };
  return { tone: "active", label: "waiting for review", detail: <WaitDetail item={item} /> };
}

/** An item's state as a pill, with one line of detail: whose review it waits for, who resolved it, or why a person decides. */
function itemStatus(item: ReviewItemView): { tone: StatusTone; label: string; detail: ReactNode } {
  switch (item.state) {
    case "open":
      return { tone: "active", label: "with the coder", detail: `round ${item.round}` };
    case "answered":
      return { tone: "active", label: "answer ready", detail: "posts after the push" };
    case "awaiting_review":
      return awaitingStatus(item);
    case "resolved":
      return { tone: "success", label: "resolved", detail: <ResolvedDetail item={item} /> };
    case "disputed":
      return { tone: "attention", label: "needs you", detail: item.stateReason ?? "" };
    case "reraised":
      return { tone: "muted", label: "raised again", detail: item.reraisedAs ? `${reviewerName(item.reviewer)} raised it again as ${item.reraisedAs}` : "" };
    case "left":
      return { tone: "muted", label: "left to you", detail: item.stateReason ?? "a person took it over on GitHub" };
    case "gone":
      return { tone: "muted", label: "gone", detail: "deleted on GitHub" };
  }
}

const DOT: Record<StatusTone, string> = {
  active: "bg-active-dot",
  attention: "bg-attention-dot",
  success: "bg-success-dot",
  muted: "bg-muted-foreground/50",
  neutral: "bg-muted-foreground/50",
  danger: "bg-danger-dot",
  repaired: "bg-repaired-dot",
};

const LINK = "text-foreground/80 hover:underline hover:underline-offset-3";

/** The line above an item's comment: the reviewer, where the comment points, outdated, and a link to it on GitHub. */
function ItemHead({ item, small }: { item: ReviewItemView; small: boolean }) {
  const Icon = item.reviewerBot ? BotIcon : UserRoundIcon;
  const place = itemPlace(item);
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-[5px] text-xs font-medium text-foreground/80">
        <Icon aria-hidden className="size-[13px] text-muted-foreground" />
        {item.reviewer}
      </span>
      {place ? (
        <a href={item.url ?? undefined} target="_blank" rel="noreferrer" className={cn("font-mono text-[11.5px]", LINK)}>
          {place}
        </a>
      ) : (
        <Tag>{KIND_TAGS[item.kind]}</Tag>
      )}
      {item.outdated && <Tag className="border-dashed">outdated</Tag>}
      {small && item.verdict && <VerdictTag verdict={item.verdict} />}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.id} on GitHub`} className="inline-flex items-center hover:text-foreground">
          <ExternalLinkIcon aria-hidden className="size-3" />
        </a>
      )}
    </div>
  );
}

/** The comment's first line in bold and the rest; a resolved item keeps only the first line. */
function ItemComment({ item, small }: { item: ReviewItemView; small: boolean }) {
  const { title, rest } = splitComment(item.body);
  return (
    <p className={cn("mt-1 line-clamp-2 text-[13px] leading-[1.45]", small && "mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground", item.state === "gone" && "text-muted-foreground line-through")}>
      <b className={cn("font-semibold", small && "font-normal")}>{title}</b>
      {!small && rest && <span className="text-foreground/80"> {rest}</span>}
    </p>
  );
}

/** The answer under an item: the verdict, the evidence, and links to the fixing commit, the item it repeats, and handoff's reply. */
function Answer({ item }: { item: ReviewItemView }) {
  if (!item.verdict) return null;
  return (
    <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border bg-muted/50 px-2.5 py-2 text-[12.5px] leading-[1.45] text-foreground/80">
      <VerdictTag verdict={item.verdict} />
      <div className="min-w-0">
        {item.evidence && <p className="line-clamp-2">{item.evidence}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          {item.commit && (
            <a href={item.commitUrl ?? undefined} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 font-mono text-[11.5px]", LINK)}>
              <GitCommitHorizontalIcon aria-hidden className="size-3 text-muted-foreground" />
              {item.commit.slice(0, 7)}
            </a>
          )}
          {item.duplicateOf && <span>same point as {item.duplicateOf}</span>}
          {item.replyUrl && (
            <a href={item.replyUrl} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1", LINK)}>
              <ReplyIcon aria-hidden className="size-3 text-muted-foreground" />
              {item.kind === "thread" ? "reply" : "round comment"}
            </a>
          )}
          {item.state === "answered" && <span>posts after the push, when the round reaches the pull request step</span>}
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: ReviewItemView }) {
  const status = itemStatus(item);
  // A resolved item shrinks to one line.
  const small = item.state === "resolved";
  return (
    <li className={cn("grid grid-cols-[38px_minmax(0,1fr)] gap-3 border-t py-[11px] sm:grid-cols-[38px_minmax(0,1fr)_200px]", small && "py-[7px]")}>
      <span data-handle className="inline-grid h-5 w-fit min-w-[30px] place-items-center rounded-[5px] bg-secondary px-1.5 font-mono text-[11.5px] leading-none font-semibold">
        {item.id}
      </span>
      <div className="min-w-0">
        <ItemHead item={item} small={small} />
        <ItemComment item={item} small={small} />
        {item.state === "open" && !item.verdict && <p className="mt-[7px] text-[12.5px] text-muted-foreground">No answer yet. The coder has it in round {item.round}.</p>}
        {!small && <Answer item={item} />}
      </div>
      <div className="col-start-2 flex flex-col items-start gap-[3px] sm:col-start-3 sm:items-end sm:text-right">
        <StatusBadge status={item.state} tone={status.tone} label={status.label} size="sm" />
        {status.detail && <span className="text-[11.5px] leading-[1.35] text-muted-foreground">{status.detail}</span>}
      </div>
    </li>
  );
}

/** The card's footer: how many items stand where, and the coder's verdicts so far. */
function Tally({ items }: { items: ReviewItemView[] }) {
  const verdicts = verdictCounts(items);
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-[18px] pt-2.5 pb-3 text-xs text-muted-foreground">
      {tallyOf(items).map((t) => (
        <span key={t.label} className="inline-flex items-center gap-1.5">
          <i aria-hidden className={cn("inline-block size-[7px] rounded-full", DOT[t.tone])} />
          {t.label} <b className="font-semibold text-foreground tabular-nums">{t.n}</b>
        </span>
      ))}
      {verdicts && <span className="ml-auto">{verdicts}</span>}
    </footer>
  );
}

/**
 * The run's review items while it has any: what each reviewer said on the pull request, the coder's
 * answer, handoff's reply, and where it stands. It sits above the run's tabs and folds to one line; the
 * fold is kept in this browser per run, open while any item is unresolved and folded once all are. The
 * merge step's unresolved threads card stays for the threads handoff does not manage.
 */
export function ReviewItemsCard({ runId, pr, items }: { runId: string; pr: { number: number; url: string } | null; items: ReviewItemView[] }) {
  const [folded, setFolded] = useReviewFold(
    runId,
    items.every((i) => i.state === "resolved"),
  );
  return (
    <Card className="gap-0 py-0">
      <Collapsible open={!folded} onOpenChange={(open) => setFolded(!open)}>
        <header className="flex items-start gap-3 px-[18px] pt-3.5 pb-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-active-bg text-active [&_svg]:size-4">
            <MessagesSquareIcon />
          </span>
          <div className="min-w-0 grow">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              Review comments
              <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-secondary px-[5px] text-[10.5px] font-semibold text-secondary-foreground tabular-nums">{items.length}</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">{reviewSummary(items)}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {pr && (
              <Button size="sm" variant="outline" asChild>
                <a href={pr.url} target="_blank" rel="noreferrer">
                  <GitPullRequestIcon data-icon="inline-start" />
                  PR #{pr.number}
                </a>
              </Button>
            )}
            <Button type="button" size="icon-sm" variant="ghost" aria-expanded={!folded} aria-label={folded ? "Show review comments" : "Fold review comments"} onClick={() => setFolded(!folded)}>
              {folded ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </Button>
          </div>
        </header>
        <CollapsibleContent>
          {groupsOf(items).map((group) => (
            <section key={group.name} aria-label={group.name} className="border-t px-[18px] pb-1">
              <h3 className="flex items-center gap-[7px] pt-[11px] pb-[7px] text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
                {group.name}
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px] tracking-normal text-secondary-foreground tabular-nums">{group.items.length}</span>
                {group.note && <span className="ml-0.5 text-xs font-normal tracking-normal normal-case">{group.note}</span>}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
          <Separator />
          <Tally items={items} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
