import { FailedRunCard, QuestionCard } from "@/components/inbox/cards";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { listInbox } from "@/server/inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const inbox = await listInbox(getDb());
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader crumbs={[{ label: "Inbox" }]} title="Inbox" description="Questions from running graphs, and runs that stopped and need a decision." />
      {inbox.count === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing needs you</EmptyTitle>
            <EmptyDescription>Human gates and failed runs show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {inbox.questions.map((q) => (
            <QuestionCard key={q.id} item={q} />
          ))}
          {inbox.failedRuns.map((f) => (
            <FailedRunCard key={f.executionId} item={{ ...f, error: f.error ?? null }} />
          ))}
        </div>
      )}
    </main>
  );
}
