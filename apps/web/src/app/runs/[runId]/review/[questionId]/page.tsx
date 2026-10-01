import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/page-header";
import { CodeReview } from "@/components/review/code-review";
import { projectCrumbs, projectRunsCrumb, runCrumb } from "@/server/crumbs";
import { PlanReview } from "@/components/review/plan-review";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
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
  changes: { status: "waiting", label: "Changes requested" },
};

function Verdict({ answered }: { answered: Answered }) {
  const verdict = VERDICT[answered.option ?? ""] ?? VERDICT.changes!;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <StatusBadge status={verdict.status} label={verdict.label} />
        <span className="text-muted-foreground">by {answered.answeredBy}</span>
      </div>
      <p>{answered.answer}</p>
    </div>
  );
}

/** Line comments from an answered code review, in the shape the diff shows them. */
const lineComments = (answered: Answered): LineComment[] =>
  answered.comments.flatMap((c) =>
    c.path && c.line !== undefined ? [{ path: c.path, side: c.side ?? "new", line: c.line, ...(c.endLine !== undefined ? { endLine: c.endLine } : {}), quote: c.quote ?? "", body: c.body }] : [],
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
          tokens={tokens}
          {...(answered ? { answered: lineComments(answered) } : {})}
        />
      </div>
    );
  }
  return answered ? <AnsweredReview markdown={shown.markdown} answered={answered} /> : <PlanReview questionId={review.id} runId={runId} from={shown.backTo ?? shown.from} markdown={shown.markdown} />;
}

/** A review that was already answered: what was reviewed, the verdict, the note and the comments. */
function AnsweredReview({ markdown, answered }: { markdown: string; answered: Answered }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="prose prose-sm max-w-none rounded-lg border p-6 dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <aside className="flex flex-col gap-3 text-sm">
        <Verdict answered={answered} />
        {answered.comments.length > 0 && (
          <ul aria-label="Comments" className="flex flex-col gap-2">
            {answered.comments.map((comment) => (
              <li key={`${comment.quote ?? ""}:${comment.body}`} className="rounded-md border p-2">
                {comment.quote && <span className="block truncate text-xs text-muted-foreground">&quot;{comment.quote}&quot;</span>}
                {comment.body}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ runId: string; questionId: string }> }) {
  const { runId, questionId } = await params;
  const review = await getReview(getDb(), runId, questionId);
  if (!review) notFound();
  const tokens = review.review.kind === "code" && review.review.files ? await highlightFiles(review.review.files) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[
          ...(await projectCrumbs(getDb(), { id: review.projectId, name: review.projectName })),
          projectRunsCrumb(review.projectId),
          await runCrumb(getDb(), review.projectId, { id: runId, task: review.task }),
          { label: review.review.kind === "code" ? "Code review" : "Review" },
        ]}
        title={review.question}
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
