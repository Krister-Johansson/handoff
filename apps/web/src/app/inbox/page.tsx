import { Count, InboxProjectFilter, InboxSections } from "@/components/inbox/inbox-sections";
import { inboxCount, narrowInbox, type InboxView } from "@/components/inbox/inbox-view";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { inboxGroups } from "@/server/inbox-groups";

export const dynamic = "force-dynamic";

/** Everything that waits on a person, grouped by what they must do, optionally for one project. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  const [{ project }, { reviews, questions, failedRuns, stuckRuns, pullRequests, readyToMerge, permissions }] = await Promise.all([searchParams, inboxGroups(getDb())]);
  const view: InboxView = { reviews, questions, failedRuns: failedRuns.map((f) => ({ ...f, error: f.error ?? null })), stuckRuns, pullRequests, readyToMerge, permissions };
  const current = typeof project === "string" ? project : undefined;
  const shown = narrowInbox(view, current);
  const total = inboxCount(view);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Inbox" }]}
        title="Inbox"
        titleExtra={total > 0 && <Count n={total} />}
        description="Everything that waits on you: reviews to open, questions to answer, pull requests ready to merge, runs that stopped, and pull requests to review."
        actions={total > 0 && <InboxProjectFilter view={view} current={current} />}
      />
      {inboxCount(shown) === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing needs you</EmptyTitle>
            <EmptyDescription>Reviews, questions, runs that stopped and pull requests to review show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <InboxSections view={shown} />
      )}
    </main>
  );
}
