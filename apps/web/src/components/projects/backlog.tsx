import Link from "next/link";
import { CircleDotIcon, GitPullRequestIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import { runPath } from "@/lib/paths";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { BacklogCounts, BacklogFilter, BacklogIssue } from "@/server/backlog";
import { BlockedRunButton, StartRunDialog } from "./forms";
import { ROW, ROWS, SectionCard } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { FilterLinks } from "@/components/filter-links";
import { LinkDependenciesButton } from "./link-dependencies-button";

const FILTERS: { value: BacklogFilter; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "started", label: "Started" },
  { value: "all", label: "All open" },
];

const EMPTY: Record<BacklogFilter, { title: string; text: string }> = {
  todo: { title: "Nothing to do", text: "Every open issue has a run. Write new issues on GitHub, by hand or with Claude Code, and they show up here." },
  started: { title: "Nothing started", text: "Start a run from an issue under To do." },
  all: { title: "No open issues", text: "Write issues on GitHub, by hand or with Claude Code, and start runs for them here." },
};

type Props = {
  projectId: string;
  graphs: string[];
  graphName: string;
  filter: BacklogFilter;
  counts: BacklogCounts;
  /** Already filtered by the page. */
  issues: BacklogIssue[];
  repoUrl?: string;
};

/** Title and description of the Issues tab's card, which the page also uses when it has no issues to show. */
export const BACKLOG_TITLE = "Open issues on GitHub";
export const BACKLOG_DESCRIPTION = "Write them there, by hand or with Claude Code, and start a run for one when you want it worked on.";

/** The repository's open issues: which have a run and which are waiting for one, with Start run for the latter. */
export function Backlog({ projectId, graphs, graphName, filter, counts, issues, repoUrl }: Props) {
  return (
    <SectionCard
      title={BACKLOG_TITLE}
      description={BACKLOG_DESCRIPTION}
      action={
        <>
          <LinkDependenciesButton projectId={projectId} />
          <FilterLinks
            label="Issue state"
            links={FILTERS.map((f) => ({ href: `?tab=issues&issues=${f.value}`, label: f.label, count: counts[f.value], current: f.value === filter }))}
          />
        </>
      }
    >
      {issues.length === 0 ? (
        <Empty className="pt-2 pb-9">
          <EmptyHeader>
            <EmptyTitle>{EMPTY[filter].title}</EmptyTitle>
            <EmptyDescription>{EMPTY[filter].text}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className={ROWS}>
          {issues.map((issue) => (
            <li key={issue.number} className={ROW}>
              <CircleDotIcon aria-hidden className="size-4 shrink-0 text-success-dot" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a href={issue.url} className="truncate hover:underline hover:underline-offset-3">
                  <span className="mr-1 font-mono text-xs text-muted-foreground">#{issue.number}</span>
                  {issue.title}
                </a>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {issue.labels.map((label) => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                  {issue.blockedBy.length > 0 && (
                    // GitHub's own dependency: no run can start for this issue until these close.
                    <Tag tone="attention" title="A run can start once these are closed">
                      <span>Blocked by</span>
                      {issue.blockedBy.map((n) => (
                        <a key={n} href={repoUrl ? `${repoUrl}/issues/${n}` : undefined} className="font-mono hover:underline">
                          #{n}
                        </a>
                      ))}
                    </Tag>
                  )}
                  {issue.author && <span>by {issue.author}</span>}
                  <span>updated {issue.updatedAt.slice(0, 10)}</span>
                </span>
              </div>
              {issue.run && issue.run.status !== "cancelled" ? (
                <span className="flex shrink-0 items-center gap-2">
                  {issue.run.prNumber !== null && repoUrl && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`${repoUrl}/pull/${issue.run.prNumber}`}>
                        <GitPullRequestIcon data-icon="inline-start" />
                        PR #{issue.run.prNumber}
                      </a>
                    </Button>
                  )}
                  <Link href={runPath(projectId, issue.run.id)} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <StatusBadge status={issue.run.status} />
                  </Link>
                </span>
              ) : (
                issue.blockedBy.length > 0 ? (
                  <BlockedRunButton label="Start run" reason={`Blocked by ${issue.blockedBy.map((n) => `#${n}`).join(", ")} on GitHub; it can start once they are closed`} />
                ) : (
                  <StartRunDialog
                    projectId={projectId}
                    graphs={graphs}
                    graphName={graphName}
                    label="Start run"
                    variant="outline"
                    initialIssues={[{ number: issue.number, title: issue.title, url: issue.url, labels: issue.labels, author: issue.author, updatedAt: issue.updatedAt, blockedBy: issue.blockedBy }]}
                  />
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
