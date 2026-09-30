import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeftIcon } from "lucide-react";
import { PlanReview } from "@/components/review/plan-review";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
import { getReview } from "@/server/review";

export const dynamic = "force-dynamic";

type Answered = NonNullable<NonNullable<Awaited<ReturnType<typeof getReview>>>["answered"]>;

/** A review that was already answered: what was reviewed, the verdict, the note and the comments. */
function AnsweredReview({ markdown, answered }: { markdown: string; answered: Answered }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="prose prose-sm max-w-none rounded-lg border p-6 dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <aside className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2">
          <StatusBadge status={answered.option === "approve" ? "succeeded" : "waiting"} label={answered.option === "approve" ? "Approved" : "Changes requested"} />
          <span className="text-muted-foreground">by {answered.answeredBy}</span>
        </div>
        <p>{answered.answer}</p>
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
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href={`/runs/${runId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          {review.projectName}: {review.task}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{review.question}</h1>
        <p className="text-muted-foreground">
          {review.answered
            ? "This review has been answered."
            : `Select text to comment on it. Request changes sends your comments back to ${review.review.from}, which tries again; Approve lets the run go on.`}
        </p>
      </div>
      {review.answered ? (
        <AnsweredReview markdown={review.review.markdown} answered={review.answered} />
      ) : (
        <PlanReview questionId={review.id} runId={runId} markdown={review.review.markdown} />
      )}
    </main>
  );
}
