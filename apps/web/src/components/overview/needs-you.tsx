import { CheckIcon } from "lucide-react";
import { ProjectCards } from "@/components/inbox/card-place";
import { FailedRunCard, PullRequestCard, QuestionCard, ReadyToMergeCard, StuckRunCard } from "@/components/inbox/cards";
import { inboxCount, type InboxView } from "@/components/inbox/inbox-view";
import { PermissionCard } from "@/components/runs/permission-card";
import { OverviewEmpty, OverviewSection } from "./overview-section";

/**
 * What waits on a person in this project: the Inbox cards for it, with their buttons, so a question or
 * a permission prompt is answered right here. Permission requests come first, as in the Inbox.
 */
export function NeedsYou({ projectId, view }: { projectId: string; view: InboxView }) {
  const count = inboxCount(view);
  return (
    <OverviewSection id="needs-you" title="Needs you" count={count} more={{ href: `/inbox?${new URLSearchParams({ project: projectId })}`, label: "Open the Inbox" }}>
      {count === 0 ? (
        <OverviewEmpty icon={CheckIcon} tone="success" title="Nothing needs you" description="Reviews, questions, runs that stopped and pull requests to review show up here." />
      ) : (
        <ProjectCards>
          <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
            {view.permissions?.map((p) => (
              <PermissionCard key={p.id} request={p} run={p} />
            ))}
            {[...view.reviews, ...view.questions].map((q) => (
              <QuestionCard key={q.id} item={q} />
            ))}
            {view.readyToMerge.map((r) => (
              <ReadyToMergeCard key={r.runId} item={r} />
            ))}
            {view.failedRuns.map((f) => (
              <FailedRunCard key={f.executionId} item={f} />
            ))}
            {view.stuckRuns.map((s) => (
              <StuckRunCard key={s.runId} item={s} />
            ))}
            {view.pullRequests.map((p) => (
              <PullRequestCard key={p.executionId} item={p} />
            ))}
          </div>
        </ProjectCards>
      )}
    </OverviewSection>
  );
}
