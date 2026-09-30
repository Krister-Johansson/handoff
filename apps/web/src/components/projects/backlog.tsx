import Link from "next/link";
import { CircleDotIcon, GitPullRequestIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { BacklogCounts, BacklogFilter, BacklogIssue } from "@/server/backlog";
import { StartRunDialog } from "./forms";

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

/** The repository's open issues: which have a run and which are waiting for one, with Start run for the latter. */
export function Backlog({ projectId, graphs, graphName, filter, counts, issues, repoUrl }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Issue state" className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button key={f.value} asChild size="sm" variant={f.value === filter ? "secondary" : "ghost"}>
            <Link href={`?tab=issues&issues=${f.value}`} scroll={false} aria-current={f.value === filter ? "page" : undefined}>
              {f.label} <span className="text-muted-foreground tabular-nums">{counts[f.value]}</span>
            </Link>
          </Button>
        ))}
      </nav>
      {issues.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{EMPTY[filter].title}</EmptyTitle>
            <EmptyDescription>{EMPTY[filter].text}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((issue) => (
            <li key={issue.number} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <CircleDotIcon aria-hidden className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a href={issue.url} className="truncate text-sm hover:underline">
                  <span className="font-mono text-muted-foreground">#{issue.number}</span> {issue.title}
                </a>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {issue.labels.map((label) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  ))}
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
                  <Link href={`/runs/${issue.run.id}`} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <StatusBadge status={issue.run.status} />
                  </Link>
                </span>
              ) : (
                <StartRunDialog
                  projectId={projectId}
                  graphs={graphs}
                  graphName={graphName}
                  label="Start run"
                  variant="outline"
                  initialIssues={[{ number: issue.number, title: issue.title, url: issue.url, labels: issue.labels, author: issue.author, updatedAt: issue.updatedAt }]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
