import { redirect } from "next/navigation";
import { oldTabPath } from "@/lib/project-tab";

/**
 * A project's own address. Its pages are routes now (Runs, Plan, Issues, ...); a link from before
 * that carries ?tab= and lands on that tab's route. Without one it opens Runs until the project
 * Overview exists.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  redirect(oldTabPath(projectId, query));
}
