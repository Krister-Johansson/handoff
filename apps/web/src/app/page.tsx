import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { homePath, LAST_PROJECT_COOKIE } from "@/lib/last-project";
import { listProjects } from "@/server/graphs";

export const dynamic = "force-dynamic";

/** The dashboard opens on the Overview of the project used last, or on Settings, Projects when there is none to open. */
export default async function Home() {
  const [projects, cookieStore] = await Promise.all([listProjects(getDb()), cookies()]);
  redirect(homePath(projects, cookieStore.get(LAST_PROJECT_COOKIE)?.value));
}
