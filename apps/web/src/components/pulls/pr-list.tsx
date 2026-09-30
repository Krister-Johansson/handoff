import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import Link from "next/link";
import { IssueLinks, type IssueLink } from "@/components/runs/issue-links";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PullItem = {
  number: number;
  title?: string;
  repo: string;
  branch: string;
  url: string;
  runId: string;
  runStatus: string;
  /** The run's task and linked issues. */
  task?: string;
  issues?: IssueLink[];
  state: "open" | "merged" | "closed" | "draft" | "unknown";
  ci: "success" | "failure" | "pending" | "unknown";
  review: "approved" | "changes_requested" | "none" | "unknown";
  additions?: number;
  deletions?: number;
};

const CI_LABEL: Record<PullItem["ci"], string> = { success: "CI passing", failure: "CI failing", pending: "CI running", unknown: "CI unknown" };
const CI_DOT: Record<PullItem["ci"], string> = { success: "bg-emerald-500", failure: "bg-destructive", pending: "bg-amber-500", unknown: "bg-muted-foreground/40" };

function StateIcon({ state }: { state: PullItem["state"] }) {
  if (state === "merged") return <GitMergeIcon className="size-4 text-violet-500" aria-label="merged" />;
  if (state === "closed") return <GitPullRequestClosedIcon className="size-4 text-destructive" aria-label="closed" />;
  if (state === "draft") return <GitPullRequestDraftIcon className="size-4 text-muted-foreground" aria-label="draft" />;
  return <GitPullRequestIcon className={cn("size-4", state === "open" ? "text-emerald-500" : "text-muted-foreground")} aria-label={state} />;
}

/** One row per pull request, like a PR bar: state, number, repository, branch, diff size and CI. */
export function PullRequestList({ items }: { items: PullItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No pull requests from handoff runs yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((pr) => (
        <li key={`${pr.repo}#${pr.number}`} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
          <StateIcon state={pr.state} />
          <a href={pr.url} className="font-mono text-sm tabular-nums hover:underline">
            #{pr.number}
          </a>
          <div className="flex min-w-0 flex-1 flex-col">
            <Link href={`/runs/${pr.runId}`} className="truncate text-sm hover:underline">
              {pr.title ?? pr.branch}
            </Link>
            {pr.task && pr.task !== pr.title && <span className="truncate text-xs text-muted-foreground">{pr.task}</span>}
            <span className="flex min-w-0 items-center gap-2">
              <IssueLinks issues={pr.issues ?? []} />
              <span className="truncate font-mono text-xs text-muted-foreground">{pr.branch}</span>
            </span>
          </div>
          {pr.review === "changes_requested" && <Badge variant="destructive">changes requested</Badge>}
          {pr.review === "approved" && <Badge variant="secondary">approved</Badge>}
          {pr.additions !== undefined && pr.deletions !== undefined && (
            <span className="flex gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>
              <span className="text-destructive">-{pr.deletions}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs" aria-label={CI_LABEL[pr.ci]} title={CI_LABEL[pr.ci]}>
            <span className={cn("size-2 rounded-full", CI_DOT[pr.ci])} />
            CI
          </span>
        </li>
      ))}
    </ul>
  );
}
