import Link from "next/link";
import { CircleDotIcon, LayersIcon } from "lucide-react";
import { issuePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

export type IssueLink = { number: number; title: string; url: string };

/** An issue with the story and the epic it was part of when its run started, nearest first. */
export type LinkedIssueWithLineage = IssueLink & { lineage?: { kind?: string | undefined; number: number; title: string }[] | undefined };

/**
 * Linked GitHub issues as small links: the number, and the title too when `showTitles`. As `meta`, they
 * sit in a page header's line of facts: an icon and "Issue #3", without a border. With `projectId` each
 * opens its issue page in handoff, else the issue on GitHub.
 */
export function IssueLinks({
  issues,
  showTitles = false,
  variant = "chip",
  projectId,
  className,
}: {
  issues: IssueLink[];
  showTitles?: boolean;
  variant?: "chip" | "meta";
  projectId?: string;
  className?: string;
}) {
  if (issues.length === 0) return null;
  const meta = variant === "meta";
  return (
    <span className={cn("inline-flex flex-wrap items-center", meta ? "gap-x-3.5 gap-y-1" : "gap-1", className)}>
      {issues.map((issue) => (
        <Link
          key={issue.number}
          href={projectId ? issuePath(projectId, issue.number) : issue.url}
          aria-label={`#${issue.number} ${issue.title}`}
          title={issue.title}
          className={cn(
            "inline-flex max-w-full items-center",
            meta
              ? "gap-[5px] hover:text-foreground hover:underline hover:underline-offset-3"
              : "gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <CircleDotIcon aria-hidden className={cn("shrink-0", meta ? "size-[13px]" : "size-3 text-success")} />
          <span className="truncate">
            {meta && "Issue "}
            {showTitles ? `#${issue.number} ${issue.title}` : `#${issue.number}`}
          </span>
        </Link>
      ))}
    </span>
  );
}

/** "Part of story #132 Board interactions · epic #121 Finish Milestone 1": the stories and epics the run's issues belong to, each opening its issue page. */
export function PartOf({ issues, projectId }: { issues: LinkedIssueWithLineage[]; projectId: string }) {
  const seen = new Set<number>();
  const parents = issues.flatMap((i) => i.lineage ?? []).filter((p) => !seen.has(p.number) && seen.add(p.number));
  if (parents.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <LayersIcon aria-hidden />
      <span>Part of</span>
      {parents.map((p, i) => (
        <span key={p.number} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <Link href={issuePath(projectId, p.number)} className="truncate hover:text-foreground hover:underline hover:underline-offset-3">
            {[p.kind, `#${p.number}`, p.title].filter(Boolean).join(" ")}
          </Link>
        </span>
      ))}
    </span>
  );
}
