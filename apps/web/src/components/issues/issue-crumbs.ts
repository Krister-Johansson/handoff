import type { Crumb } from "@/components/page-trail";
import { projectPath } from "@/lib/paths";
import type { IssueSection } from "@/server/issue-page";

export type ProjectRef = { id: string; name: string; repo: string };

/**
 * An issue page's trail: the project, then Plan for an item of the plan or Issues for another issue,
 * then the issue. Below 768 px it keeps its last two crumbs.
 */
export function issueCrumbs(project: ProjectRef, section: IssueSection, last: string): Crumb[] {
  return [
    { label: project.name, href: projectPath(project.id), wide: true },
    { label: section === "plan" ? "Plan" : "Issues", href: projectPath(project.id, section) },
    { label: last },
  ];
}
