import type { ReactNode } from "react";
import { FailedRunCard, PullRequestCard, QuestionCard, ReadyToMergeCard, StuckRunCard } from "./cards";
import { FilterLinks } from "@/components/filter-links";
import { PermissionCard } from "@/components/runs/permission-card";
import { inboxCount, inboxItems, type InboxView } from "./inbox-view";

/** A count beside a heading. */
export function Count({ n }: { n: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-[5px] text-[11px] font-semibold tracking-normal text-secondary-foreground tabular-nums">
      {n}
    </span>
  );
}

/** Links that narrow the inbox to one project, each with how many items it has, in the order they first appear. */
export function InboxProjectFilter({ view, current }: { view: InboxView; current: string | undefined }) {
  const projects = new Map<string, { name: string; count: number }>();
  for (const item of inboxItems(view)) {
    const entry = projects.get(item.projectId) ?? { name: item.projectName, count: 0 };
    projects.set(item.projectId, { ...entry, count: entry.count + 1 });
  }
  return (
    <FilterLinks
      label="Project"
      links={[
        { label: "All", href: "/inbox", count: inboxCount(view), current: !current },
        ...[...projects].map(([id, { name, count }]) => ({ label: name, href: `/inbox?project=${encodeURIComponent(id)}`, count, current: current === id })),
      ]}
    />
  );
}

function Group({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="flex items-center gap-2 text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {title}
        <Count n={count} />
      </h2>
      {children}
    </section>
  );
}

/** The inbox's groups, each under a heading with its count; empty groups are left out. */
export function InboxSections({ view }: { view: InboxView }) {
  return (
    <div className="flex flex-col gap-6">
      <Group id="inbox-permissions" title="Permission requests" count={view.permissions?.length ?? 0}>
        {view.permissions?.map((p) => (
          <PermissionCard key={p.id} request={p} run={p} />
        ))}
      </Group>
      <Group id="inbox-reviews" title="Reviews to open" count={view.reviews.length}>
        {view.reviews.map((q) => (
          <QuestionCard key={q.id} item={q} />
        ))}
      </Group>
      <Group id="inbox-questions" title="Questions to answer" count={view.questions.length}>
        {view.questions.map((q) => (
          <QuestionCard key={q.id} item={q} />
        ))}
      </Group>
      <Group id="inbox-ready" title="Ready to merge" count={view.readyToMerge.length}>
        {view.readyToMerge.map((r) => (
          <ReadyToMergeCard key={r.runId} item={r} />
        ))}
      </Group>
      <Group id="inbox-stopped" title="Runs that stopped" count={view.failedRuns.length + view.stuckRuns.length}>
        {view.failedRuns.map((f) => (
          <FailedRunCard key={f.executionId} item={f} />
        ))}
        {view.stuckRuns.map((s) => (
          <StuckRunCard key={s.runId} item={s} />
        ))}
      </Group>
      <Group id="inbox-pulls" title="Pull requests waiting for your review" count={view.pullRequests.length}>
        {view.pullRequests.map((p) => (
          <PullRequestCard key={p.executionId} item={p} />
        ))}
      </Group>
    </div>
  );
}
