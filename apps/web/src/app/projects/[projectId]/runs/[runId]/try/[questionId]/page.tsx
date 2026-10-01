import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TryReview } from "@/components/review/try-review";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
import { tryPath } from "@/lib/paths";
import { projectCrumbs, projectRunsCrumb, runCrumb } from "@/server/crumbs";
import { getTryReview } from "@/server/try-review";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { status: "succeeded" | "waiting"; label: string }> = {
  approve: { status: "succeeded", label: "Approved" },
  changes: { status: "waiting", label: "Sent back" },
};

/** A Try it gate's page: open the run's app and check each acceptance criterion, as a code review checks each file. */
export default async function TryPage({ params }: { params: Promise<{ projectId: string; runId: string; questionId: string }> }) {
  const { projectId, runId, questionId } = await params;
  const review = await getTryReview(getDb(), runId, questionId);
  if (!review) notFound();
  if (review.projectId !== projectId) redirect(tryPath(review.projectId, runId, questionId));
  const verdict = review.answered ? (VERDICT[review.answered.option ?? ""] ?? VERDICT.changes!) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[
          ...(await projectCrumbs(getDb(), { id: review.projectId, name: review.projectName })),
          projectRunsCrumb(review.projectId),
          await runCrumb(getDb(), review.projectId, { id: runId, task: review.task }),
          { label: "Try it" },
        ]}
        title={review.question}
        titleExtra={verdict ? <StatusBadge status={verdict.status} label={verdict.label} /> : <StatusBadge status="waiting" label="waiting for you" />}
        description={
          review.answered
            ? "This has been answered."
            : `Open the app and check each criterion. Works collapses it and moves on; what does not work goes back to ${review.backTo}.`
        }
      />
      <TryReview
        questionId={review.id}
        runId={runId}
        from={review.backTo}
        acceptance={review.acceptance}
        preview={review.preview}
        shots={review.shots}
        {...(review.answered ? { answered: review.answered } : {})}
      />
    </main>
  );
}
