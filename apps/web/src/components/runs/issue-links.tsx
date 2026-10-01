import { CircleDotIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IssueLink = { number: number; title: string; url: string };

/**
 * Linked GitHub issues as small links: the number, and the title too when `showTitles`. As `meta`, they
 * sit in a page header's line of facts: an icon and "Issue #3", without a border.
 */
export function IssueLinks({
  issues,
  showTitles = false,
  variant = "chip",
  className,
}: {
  issues: IssueLink[];
  showTitles?: boolean;
  variant?: "chip" | "meta";
  className?: string;
}) {
  if (issues.length === 0) return null;
  const meta = variant === "meta";
  return (
    <span className={cn("inline-flex flex-wrap items-center", meta ? "gap-x-3.5 gap-y-1" : "gap-1", className)}>
      {issues.map((issue) => (
        <a
          key={issue.number}
          href={issue.url}
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
        </a>
      ))}
    </span>
  );
}
