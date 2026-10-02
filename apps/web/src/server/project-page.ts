import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { Crumb } from "../components/page-header";
import { projectCrumb } from "./crumbs";
import { getProjectDetail } from "./graphs";

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

/** The project a project page shows, or the not-found page when there is none by that id. */
export async function projectPage(projectId: string): Promise<ProjectDetail> {
  const detail = await getProjectDetail(getDb(), projectId);
  if (!detail) notFound();
  return detail;
}

/** The project's repository on GitHub. */
export const repoUrl = (project: { repoOwner: string; repoName: string }) => `https://github.com/${project.repoOwner}/${project.repoName}`;

/** A project page's trail: the project, then the page. */
export const sectionCrumbs = (project: { id: string; name: string }, label: string): Crumb[] => [projectCrumb(project), { label }];
