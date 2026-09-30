import { CircleDotIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IssueLink = { number: number; title: string; url: string };

/** Linked GitHub issues as small links: the number, and the title too when `showTitles`. */
export function IssueLinks({ issues, showTitles = false, className }: { issues: IssueLink[]; showTitles?: boolean; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {issues.map((issue) => (
        <a
          key={issue.number}
          href={issue.url}
          aria-label={`#${issue.number} ${issue.title}`}
          title={issue.title}
          className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CircleDotIcon aria-hidden className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate">{showTitles ? `#${issue.number} ${issue.title}` : `#${issue.number}`}</span>
        </a>
      ))}
    </span>
  );
}
