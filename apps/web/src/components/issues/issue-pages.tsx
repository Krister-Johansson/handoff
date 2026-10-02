"use client";

import { createContext, use, type ReactNode } from "react";
import { issuePath } from "@/lib/paths";

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
