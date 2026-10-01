import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { IssueLinks, type IssueLink } from "@/components/runs/issue-links";
import { runPath } from "@/lib/paths";
import { Tag } from "@/components/tag";
import { cn } from "@/lib/utils";

export type PullItem = {
  number: number;
  title?: string;
  repo: string;
  branch: string;
  url: string;
  runId: string;
  projectId: string;
  runStatus: string;
  /** The run's task and linked issues. */
  task?: string;
  issues?: IssueLink[];
  archived?: boolean;
  state: "open" | "merged" | "closed" | "draft" | "unknown";
  ci: "success" | "failure" | "pending" | "unknown";
  review: "approved" | "changes_requested" | "none" | "unknown";
  additions?: number;
  deletions?: number;
};

const CI_LABEL: Record<PullItem["ci"], string> = { success: "CI passing", failure: "CI failing", pending: "CI running", unknown: "CI unknown" };
const CI_DOT: Record<PullItem["ci"], string> = { success: "bg-success-dot", failure: "bg-danger-dot", pending: "bg-attention-dot", unknown: "bg-muted-foreground/40" };

/** handoff titles a PR with its task, cut at 72 characters with "..."; then the task adds nothing. */
const titleShowsTask = (title: string | undefined, task: string) => title !== undefined && task.startsWith(title.replace(/\.\.\.$/, ""));

function StateIcon({ state }: { state: PullItem["state"] }) {
  if (state === "merged") return <GitMergeIcon className="size-4 shrink-0 text-repaired-dot" aria-label="merged" />;
  if (state === "closed") return <GitPullRequestClosedIcon className="size-4 shrink-0 text-danger-dot" aria-label="closed" />;
  if (state === "draft") return <GitPullRequestDraftIcon className="size-4 shrink-0 text-muted-foreground" aria-label="draft" />;
  return <GitPullRequestIcon className={cn("size-4 shrink-0", state === "open" ? "text-success-dot" : "text-muted-foreground")} aria-label={state} />;
}

/** One row per pull request, like a PR bar: state, number, repository, branch, diff size and CI. */
export function PullRequestList({
  items,
  actions,
  emptyText = "No pull requests from handoff runs yet.",
}: {
  items: PullItem[];
  /** Extra controls at the end of each row, such as archiving. */
  actions?: (pr: PullItem) => ReactNode;
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="px-5 py-9 text-center text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="flex flex-col divide-y">
      {items.map((pr) => (
        <li key={`${pr.repo}#${pr.number}`} className="flex min-w-0 items-center gap-3 px-5 py-2.5 hover:bg-muted">
          <StateIcon state={pr.state} />
          <a href={pr.url} className="w-11 shrink-0 font-mono text-xs tabular-nums hover:underline hover:underline-offset-3">
            #{pr.number}
          </a>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <Link href={runPath(pr.projectId, pr.runId)} className="truncate font-medium hover:underline hover:underline-offset-3">
              {pr.title ?? pr.branch}
            </Link>
            {pr.task && !titleShowsTask(pr.title, pr.task) && <span className="truncate text-xs text-muted-foreground">{pr.task}</span>}
            <span className="flex min-w-0 items-center gap-1.5">
              <IssueLinks issues={pr.issues ?? []} className="shrink-0" />
              <span className="truncate font-mono text-xs text-muted-foreground">{pr.branch}</span>
            </span>
          </div>
          {pr.review === "changes_requested" && <Tag tone="danger">changes requested</Tag>}
          {pr.review === "approved" && <Tag tone="fill">approved</Tag>}
          {pr.additions !== undefined && pr.deletions !== undefined && (
            <span className="flex shrink-0 gap-1.5 rounded-[5px] bg-secondary px-2 py-0.5 font-mono text-[11px] tabular-nums">
              <span className="text-success">+{pr.additions}</span>
              <span className="text-danger">-{pr.deletions}</span>
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1.5 rounded-[5px] bg-secondary px-2 py-0.5 text-[11px]">
            <span aria-hidden className={cn("size-[7px] rounded-full", CI_DOT[pr.ci])} />
            {CI_LABEL[pr.ci]}
          </span>
          {actions?.(pr)}
        </li>
      ))}
    </ul>
  );
}
