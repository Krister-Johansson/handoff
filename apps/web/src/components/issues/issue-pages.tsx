"use client";

import { createContext, use, type ReactNode } from "react";
import Link from "next/link";
import { issuePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

const IssuePagesContext = createContext<string | undefined>(undefined);

/** Lets the issue titles inside link to their issue pages in this project rather than to GitHub. */
export function IssuePages({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <IssuePagesContext value={projectId}>{children}</IssuePagesContext>;
}

/** Where an issue's title leads: its issue page inside IssuePages, else the issue on GitHub. */
export function useIssueHref(item: { number: number; url: string }) {
  const projectId = use(IssuePagesContext);
  return projectId ? issuePath(projectId, item.number) : item.url;
}

/** "#57 Add the migration", opening the issue's page (on GitHub outside IssuePages); Enter on a focused tree row follows it. */
export function IssueTitle({ item, className }: { item: { number: number; title: string; url: string }; className?: string }) {
  return (
    <Link href={useIssueHref(item)} data-title className={cn("min-w-0 truncate text-[13px] hover:underline hover:underline-offset-3", className)} title={item.title}>
      <span className="font-mono text-xs font-normal text-muted-foreground">#{item.number}</span> {item.title}
    </Link>
  );
}
