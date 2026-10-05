"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BotIcon, CircleCheckIcon, CodeIcon, CornerDownLeftIcon, ExternalLinkIcon, GitCommitHorizontalIcon, HandIcon, ScaleIcon, UserRoundIcon } from "lucide-react";
import { answerReviewItemsAction } from "@/app/inbox/actions";
import { useCardPlace } from "@/components/inbox/card-place";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAgo } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { reviewerName } from "@/lib/reviewers";
import { isVerdict, itemPlace, KIND_TAGS, type ReviewItemKind, type ReviewVerdict } from "@/lib/review-items";
import { VerdictTag } from "./review-items-card";

/** A review items question as the Inbox and the run page show it. `context.items` holds both sides of each item. */
export type ReviewItemsQuestionItem = {
  id: string;
  runId: string;
  projectId: string;
  task: string;
  projectName: string;
  nodeKey: string;
  question: string;
  context?: Record<string, unknown>;
  createdAt?: Date | string;
};

/** One item the question asks about, as the PR step wrote it into the question's context. */
type AskedItem = {
  id: string;
  kind: ReviewItemKind;
  reviewer: string;
  path?: string;
  line?: number;
  url?: string;
  why: "disputed" | "no_review";
  reason: string;
  comment: string;
  conversation: { author: string; body: string }[];
  verdict: ReviewVerdict | null;
  evidence: string;
  commit?: string;
  replyUrl?: string;
};

type Choice = "resolve" | "send_back" | "leave";
type Picked = { choice?: Choice; note: string };

/** The items a question's context lists, read leniently. */
function askedItems(context: Record<string, unknown> | undefined): AskedItem[] {
  const raw = Array.isArray(context?.items) ? (context.items as Record<string, unknown>[]) : [];
  return raw.map((i) => ({
    id: String(i.id),
    kind: (["thread", "review_body", "summary_note", "pre_merge_check"].includes(String(i.kind)) ? i.kind : "thread") as ReviewItemKind,
    reviewer: String(i.reviewer ?? ""),
    ...(typeof i.path === "string" ? { path: i.path } : {}),
    ...(typeof i.line === "number" ? { line: i.line } : {}),
    ...(typeof i.url === "string" ? { url: i.url } : {}),
    why: i.why === "no_review" ? "no_review" : "disputed",
    reason: String(i.reason ?? ""),
    comment: String(i.comment ?? ""),
    conversation: Array.isArray(i.conversation) ? (i.conversation as { author?: unknown; body?: unknown }[]).map((c) => ({ author: String(c.author ?? ""), body: String(c.body ?? "") })) : [],
    verdict: isVerdict(i.verdict) ? i.verdict : null,
    evidence: String(i.evidence ?? ""),
    ...(typeof i.commit === "string" ? { commit: i.commit } : {}),
    ...(typeof i.replyUrl === "string" ? { replyUrl: i.replyUrl } : {}),
  }));
}

/** Why the item came to a person, in a few words for its tag; the whole reason is its title. */
function shortReason(item: AskedItem): string {
  if (item.why === "no_review") return "no review in time";
  if (item.verdict === "declined") return "declined twice";
  if (item.verdict === "unclear") return "unclear twice";
  if (item.verdict === "fixed") return "listed again after a fix";
  return "disputed";
}

/** The card's title: who disagrees, or who did not review again. */
function titleOf(items: AskedItem[], fallback: string): string {
  const reviewers = [...new Set(items.map((i) => reviewerName(i.reviewer)))].join(" and ");
  const count = `${items.length} review ${items.length === 1 ? "comment" : "comments"}`;
  if (items.length && items.every((i) => i.why === "disputed")) return `${reviewers} and the coder disagree on ${count}`;
  if (items.length && items.every((i) => i.why === "no_review")) return `${reviewers} did not review again in time (${count})`;
  return fallback;
}

const hasThread = (item: AskedItem) => item.kind === "thread";

function helpOf(item: AskedItem, choice: Choice | undefined): string {
  if (choice === "resolve") return hasThread(item) ? "handoff resolves the thread and posts that you resolved it, with your note." : "handoff marks it done. Nothing is posted; this comment has no thread.";
  if (choice === "send_back") return "The coder gets the comment again with your note, as a decision it must follow.";
  if (choice === "leave") return "handoff stops here. Answer or resolve it on GitHub; the merge waits for it if the branch requires resolved conversations.";
  return "Pick one.";
}

const listed = (ids: string[]) => (ids.length <= 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);

type Entry = { key: string; who: string; role: string; body: string; avatar: "bot" | "person" | "handoff" | "coder"; verdict?: ReviewVerdict | null; unposted?: boolean; commit?: string };

/**
 * What a person reads for one item: the reviewer's comment, the thread since (handoff's answers and the
 * reviewer's replies), and the coder's latest answer. That answer is marked not posted when the reviewer
 * answered back after handoff's last reply, since handoff posts nothing more on a disputed thread.
 */
function entriesOf(item: AskedItem): Entry[] {
  const reviewerAvatar = (login: string) => (/\[bot\]$|^coderabbitai$|^copilot/i.test(login) ? "bot" : "person");
  const entries: Entry[] = [{ key: "comment", who: item.reviewer, role: "comment", body: item.comment, avatar: reviewerAvatar(item.reviewer) }];
  for (const [n, c] of item.conversation.entries()) {
    const key = `thread-${n}`;
    entries.push(c.author === "handoff" ? { key, who: "handoff", role: "posted answer", body: c.body, avatar: "handoff" } : { key, who: c.author, role: "reply", body: c.body, avatar: reviewerAvatar(c.author) });
  }
  const last = item.conversation.at(-1);
  if (!last) {
    // An item without a thread: its answer went out in a PR comment, if it went out at all.
    entries.push({ key: "answer", who: "coder", role: "answer", body: item.evidence, avatar: "coder", verdict: item.verdict, unposted: !item.replyUrl, ...(item.commit ? { commit: item.commit } : {}) });
  } else if (last.author !== "handoff") {
    entries.push({ key: "answer", who: "coder", role: "second answer", body: item.evidence, avatar: "coder", verdict: item.verdict, unposted: true, ...(item.commit ? { commit: item.commit } : {}) });
  } else {
    const posted = entries.at(-1)!;
    posted.verdict = item.verdict;
    if (item.commit) posted.commit = item.commit;
  }
  return entries;
}

const AVATARS = {
  bot: { icon: BotIcon, className: "rounded-full bg-secondary text-muted-foreground" },
  person: { icon: UserRoundIcon, className: "rounded-full bg-secondary text-muted-foreground" },
  coder: { icon: CodeIcon, className: "rounded-md bg-active-bg text-active" },
} as const;

function Avatar({ kind }: { kind: Entry["avatar"] }) {
  if (kind === "handoff") {
    return (
      <span aria-hidden className="grid size-[22px] place-items-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
        h
      </span>
    );
  }
  const { icon: Icon, className } = AVATARS[kind];
  return (
    <span aria-hidden className={cn("grid size-[22px] place-items-center [&_svg]:size-3", className)}>
      <Icon />
    </span>
  );
}

function Conversation({ item, commitUrl }: { item: AskedItem; commitUrl: (sha: string) => string | undefined }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {entriesOf(item).map((e) => (
        <li key={e.key} className="grid grid-cols-[22px_minmax(0,1fr)] gap-[9px]">
          <Avatar kind={e.avatar} />
          <div className={cn("min-w-0", e.unposted && "rounded-md border border-dashed px-[9px] pt-1.5 pb-2")}>
            <div className="flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <b className="font-medium text-foreground">{e.who}</b>
              <span>{e.role}</span>
              {e.verdict && <VerdictTag verdict={e.verdict} />}
              {e.unposted && <Tag className="border-dashed">not posted</Tag>}
            </div>
            <p className="text-[13px] leading-normal whitespace-pre-line text-foreground/80">{e.body}</p>
            {e.commit && (
              <a href={commitUrl(e.commit)} target="_blank" rel="noreferrer" className="mt-[3px] inline-flex items-center gap-1 font-mono text-[11.5px] text-foreground/80 hover:underline hover:underline-offset-3">
                <GitCommitHorizontalIcon aria-hidden className="size-3 text-muted-foreground" />
                {e.commit.slice(0, 7)}
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The line above an item: its handle, why a person decides, the reviewer, where it points, and a link to it on GitHub. */
function ItemHeader({ item }: { item: AskedItem }) {
  const place = itemPlace({ path: item.path ?? null, line: item.line ?? null });
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-grid h-5 min-w-[30px] place-items-center rounded-[5px] bg-secondary px-1.5 font-mono text-[11.5px] leading-none font-semibold text-foreground">{item.id}</span>
      <Tag tone="attention" title={item.reason}>
        {shortReason(item)}
      </Tag>
      <span className="font-medium text-foreground/80">{item.reviewer}</span>
      {place ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-foreground/80 hover:underline hover:underline-offset-3">
          {place}
        </a>
      ) : (
        <Tag>{KIND_TAGS[item.kind]}</Tag>
      )}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
          {hasThread(item) ? "thread" : "PR comment"}
          <ExternalLinkIcon aria-hidden className="size-3" />
        </a>
      )}
    </div>
  );
}

/** One choice per item, Resolve (Mark done without a thread), Send back or Leave, with what it does. */
function ItemChoice({ item, picked, onPick }: { item: AskedItem; picked: Picked; onPick: (next: Picked) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={`What to do with ${item.id}`}
        value={picked.choice ?? ""}
        onValueChange={(value) => onPick({ ...picked, choice: value ? (value as Choice) : undefined })}
      >
        <ToggleGroupItem value="resolve" className="data-[state=on]:bg-success-bg data-[state=on]:text-success">
          <CircleCheckIcon data-icon="inline-start" />
          {hasThread(item) ? "Resolve" : "Mark done"}
        </ToggleGroupItem>
        <ToggleGroupItem value="send_back" className="data-[state=on]:bg-attention-bg data-[state=on]:text-attention">
          <CornerDownLeftIcon data-icon="inline-start" />
          Send back
        </ToggleGroupItem>
        <ToggleGroupItem value="leave">
          <HandIcon data-icon="inline-start" />
          Leave
        </ToggleGroupItem>
      </ToggleGroup>
      <span className="min-w-[260px] flex-1 text-xs leading-snug text-muted-foreground">{helpOf(item, picked.choice)}</span>
    </div>
  );
}

/** Whether a choice takes a note: Send back, for the coder, and Resolve on a thread, posted in it. */
const takesNote = (item: AskedItem, choice: Choice | undefined) => choice === "send_back" || (choice === "resolve" && hasThread(item));

function ItemBlock({ item, picked, onPick, commitUrl }: { item: AskedItem; picked: Picked; onPick: (next: Picked) => void; commitUrl: (sha: string) => string | undefined }) {
  const noteId = `review-item-note-${item.id}`;
  const forCoder = picked.choice === "send_back";
  return (
    <section aria-label={item.id} className="mt-3 overflow-hidden rounded-lg border">
      <ItemHeader item={item} />
      <div className="flex flex-col gap-3 p-3">
        <Conversation item={item} commitUrl={commitUrl} />
        <ItemChoice item={item} picked={picked} onPick={onPick} />
        {takesNote(item, picked.choice) && (
          <Field>
            <FieldLabel htmlFor={noteId} className="text-[12.5px]">
              {forCoder ? "Note for the coder (optional)" : "Note in the thread (optional)"}
            </FieldLabel>
            <Textarea
              id={noteId}
              rows={2}
              value={picked.note}
              onChange={(e) => onPick({ ...picked, note: e.target.value })}
              placeholder={forCoder ? "What the coder should do, for example the test to add" : "Posted after the line that says you resolved it"}
            />
          </Field>
        )}
      </div>
    </section>
  );
}

/** The line above the card's title: its tag, the project and run outside the run page, the step, and when it asked. */
function QuestionContext({ item, compact }: { item: ReviewItemsQuestionItem; compact: boolean }) {
  const inProject = useCardPlace() === "project";
  const linkClass = "hover:text-foreground hover:underline hover:underline-offset-3";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Tag tone="attention">Review comments to decide</Tag>
      {!compact && !inProject && (
        <>
          <Link href={`/projects/${item.projectId}`} className={linkClass}>
            {item.projectName}
          </Link>
          <span aria-hidden>·</span>
        </>
      )}
      {!compact && (
        <>
          <Link href={runPath(item.projectId, item.runId)} className={cn("max-w-full min-w-0 truncate", linkClass)}>
            {item.task}
          </Link>
          <span aria-hidden>·</span>
        </>
      )}
      <span className="font-mono">{item.nodeKey}</span>
      {item.createdAt && (
        <span className="ml-auto whitespace-nowrap" title={new Date(item.createdAt).toISOString()} suppressHydrationWarning>
          asked {formatAgo(new Date(item.createdAt))}
        </span>
      )}
    </div>
  );
}

/**
 * Review comments handoff cannot settle: the reviewer and the coder still disagree, or the reviewer did not
 * review again in time. Each block shows both sides and takes one choice, Resolve (Mark done without a
 * thread), Send back or Leave; Resolve all fills in Resolve everywhere. One Submit sends every choice.
 */
export function ReviewItemsQuestionCard({ item, compact = false }: { item: ReviewItemsQuestionItem; compact?: boolean }) {
  const items = askedItems(item.context);
  const [picks, setPicks] = useState<Record<string, Picked>>({});
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const pr = item.context?.pr as { url?: string } | undefined;
  const repoUrl = pr?.url?.replace(/\/pull\/\d+$/, "");
  const commitUrl = (sha: string) => (repoUrl ? `${repoUrl}/commit/${sha}` : undefined);
  const pickOf = (id: string): Picked => picks[id] ?? { note: "" };
  const missing = items.filter((i) => !pickOf(i.id).choice).map((i) => i.id);
  const chosen = items.length - missing.length;

  const submit = () => {
    setTried(true);
    if (missing.length) return;
    const choices = items.map((i) => {
      const { choice, note } = pickOf(i.id);
      const kept = takesNote(i, choice) && note.trim() ? { note: note.trim() } : {};
      return { id: i.id, choice: choice!, ...kept };
    });
    start(async () => {
      const result = await answerReviewItemsAction({ questionId: item.id, runId: item.runId, items: choices });
      setError(result.ok ? undefined : result.error);
    });
  };
  const resolveAll = () => setPicks(Object.fromEntries(items.map((i) => [i.id, { ...pickOf(i.id), choice: "resolve" as const }])));
  const status = missing.length ? `Pick a choice for ${listed(missing)}.` : `${chosen} of ${items.length} chosen`;

  return (
    <article aria-label="Review comments to decide" className="grid grid-cols-[36px_minmax(0,1fr)] gap-3.5 rounded-xl bg-card px-[18px] py-4 text-sm text-card-foreground ring-1 ring-attention-dot/40">
      <span aria-hidden className="grid size-9 place-items-center rounded-[9px] bg-attention-bg text-attention [&_svg]:size-4">
        <ScaleIcon />
      </span>
      <div className="flex min-w-0 flex-col">
        <QuestionContext item={item} compact={compact} />
        <h3 className="mt-[3px] text-[15px] leading-[1.35] font-semibold">{titleOf(items, item.question)}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Pick one choice per comment; handoff does it on GitHub when you submit.</p>
        {items.map((asked) => (
          <ItemBlock key={asked.id} item={asked} picked={pickOf(asked.id)} onPick={(next) => setPicks((all) => ({ ...all, [asked.id]: next }))} commitUrl={commitUrl} />
        ))}
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <Button type="button" onClick={submit} disabled={pending}>
            Submit
          </Button>
          {items.length > 1 && (
            <Button type="button" variant="outline" onClick={resolveAll} disabled={pending}>
              Resolve all
            </Button>
          )}
          <span role="status" className={cn("text-[12.5px] text-muted-foreground", tried && missing.length > 0 && "text-danger")}>
            {status}
          </span>
          {!compact && (
            <Button variant="ghost" asChild>
              <Link href={runPath(item.projectId, item.runId)}>Open the run</Link>
            </Button>
          )}
        </div>
        {error && <FieldError className="mt-2">{error}</FieldError>}
      </div>
    </article>
  );
}
