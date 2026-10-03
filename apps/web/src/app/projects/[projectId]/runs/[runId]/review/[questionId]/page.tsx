import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ListIcon, MessageSquareIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { PageHeader } from "@/components/page-header";
import { CodeReview } from "@/components/review/code-review";
import { projectCrumb, projectRunsCrumb, runCrumb } from "@/server/crumbs";
import { PlanReview } from "@/components/review/plan-review";
import { CARD, PROSE } from "@/components/review/styles";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { diffTotals } from "@/lib/diff-rows";
import { reviewPath, runPath } from "@/lib/paths";
import type { LineTokens } from "@/lib/highlight-types";
import type { LineComment } from "@/lib/line-comments";
import { highlightFiles } from "@/server/highlight";
import { getReview } from "@/server/review";

export const dynamic = "force-dynamic";

type Review = NonNullable<Awaited<ReturnType<typeof getReview>>>;
type Answered = NonNullable<Review["answered"]>;

const VERDICT: Record<string, { status: "succeeded" | "waiting"; label: string }> = {
  approve: { status: "succeeded", label: "Approved" },
  fix: { status: "succeeded", label: "Approved after fixes" },
  split: { status: "succeeded", label: "Split as proposed" },
  changes: { status: "waiting", label: "Changes requested" },
};

function Verdict({ answered }: { answered: Answered }) {
  const verdict = VERDICT[answered.option ?? ""] ?? VERDICT.changes!;
  return (
    <div className={`${CARD} flex flex-col gap-2 px-5 py-4 text-[13px]`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={verdict.status} label={verdict.label} />
        <span className="text-xs text-muted-foreground">by {answered.answeredBy}</span>
      </div>
      {answered.answer && <p className="whitespace-pre-wrap">{answered.answer}</p>}
    </div>
  );
}

/** How big the change under review is, and which round of this gate it is when it is not the first. */
function ChangeSize({ files, round }: { files: DiffFile[]; round: number }) {
  const { additions, deletions, files: count } = diffTotals(files);
  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-mono">
        <span className="text-success">{`+${additions}`}</span> <span className="text-danger">{`−${deletions}`}</span>
      </span>
      <span>{`${count} ${count === 1 ? "file" : "files"}`}</span>
      {round > 1 && <span>{`round ${round}`}</span>}
    </span>
  );
}

function RunSteps({ href }: { href: string }) {
  return (
    <Button asChild variant="outline">
      <Link href={href}>
        <ListIcon data-icon="inline-start" />
        Run steps
      </Link>
    </Button>
  );
}

/**
 * The person's line comments from an answered code review, in the shape the diff shows them. The code
 * reviewer's findings they sent back carry an author and already sit on their lines as findings.
 */
const lineComments = (answered: Answered): LineComment[] =>
  answered.comments.flatMap((c) =>
    c.path && c.line !== undefined && !c.author ? [{ path: c.path, side: c.side ?? "new", line: c.line, ...(c.endLine !== undefined ? { endLine: c.endLine } : {}), quote: c.quote ?? "", body: c.body }] : [],
  );

function ReviewBody({ review, runId, tokens }: { review: Review; runId: string; tokens: Record<string, LineTokens> | undefined }) {
  const { review: shown, answered } = review;
  if (shown.kind === "code" && shown.files) {
    return (
      <div className="flex flex-col gap-4">
        {answered && <Verdict answered={answered} />}
        <CodeReview questionId={review.id} runId={runId} from={shown.backTo ?? shown.from} markdown={shown.markdown} files={shown.files}
          views={review.views}
          earlier={review.earlier}
          findings={review.findings && { ...review.findings, by: shown.from, followUp: review.followUp }}
          tokens={tokens}
          {...(answered ? { answered: lineComments(answered) } : {})}
        />
      </div>
    );
  }
  return answered ? (
    <AnsweredReview markdown={shown.markdown} answered={answered} />
  ) : (
    <PlanReview questionId={review.id} runId={runId} from={shown.backTo ?? shown.from} markdown={shown.markdown} options={review.options} overlaps={review.overlaps} />
  );
}

/** A review that was already answered: what was reviewed, the verdict, the note and the comments. */
function AnsweredReview({ markdown, answered }: { markdown: string; answered: Answered }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <article className={`${CARD} ${PROSE} px-8 py-7`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[76px]">
        <Verdict answered={answered} />
        {answered.comments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{`${answered.comments.length} ${answered.comments.length === 1 ? "comment" : "comments"}`}</span>
            <ul aria-label="Comments" className="flex flex-col gap-1.5">
              {answered.comments.map((comment) => (
                <li key={`${comment.quote ?? ""}:${comment.body}`} className="flex items-start gap-2 rounded-lg border bg-subtle px-3 py-2.5 text-[13px]">
                  <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {comment.quote && <span className="truncate text-xs text-muted-foreground italic">&quot;{comment.quote}&quot;</span>}
                    <span className="whitespace-pre-wrap">{comment.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string; runId: string; questionId: string }> }) {
  const { projectId, runId, questionId } = await params;
  const review = await getReview(getDb(), runId, questionId);
  if (!review) notFound();
  if (review.projectId !== projectId) redirect(reviewPath(review.projectId, runId, questionId));
  const tokens = review.review.kind === "code" && review.review.files ? await highlightFiles(review.review.files) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[
          projectCrumb({ id: review.projectId, name: review.projectName }),
          projectRunsCrumb(review.projectId),
          await runCrumb(getDb(), review.projectId, { id: runId, task: review.task }),
          { label: review.review.kind === "code" ? "Code review" : "Review" },
        ]}
        title={review.question}
        titleExtra={!review.answered && <StatusBadge status="waiting" label="waiting for you" />}
        actions={review.review.kind === "code" && review.review.files ? <ChangeSize files={review.review.files} round={review.earlier.length + 1} /> : <RunSteps href={runPath(review.projectId, runId)} />}
        description={
          review.answered
            ? "This review has been answered."
            : review.review.kind === "code"
              ? `Click a line number, or shift-click a second one for a range, to comment on those lines. Submit review sends your comments back to ${review.review.backTo ?? review.review.from} or lets the run go on.`
              : `Select text to comment on it. Submit your review to send your comments back to ${review.review.backTo ?? review.review.from} or let the run go on.`
        }
      />
      <ReviewBody review={review} runId={runId} tokens={tokens} />
    </main>
  );
}
