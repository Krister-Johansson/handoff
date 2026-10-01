import { wakeByKey, type Db } from "@handoff/db";

/** The key a project's runs wait on while GitHub says an issue they work on is blocked by an open issue. */
export const depsKey = (projectId: string) => `deps:${projectId}`;

/** Lets every run of the project that waits on a blocked issue check again, for example after an issue closed. */
export async function wakeDependents(db: Db, projectId: string) {
  await wakeByKey(db, depsKey(projectId), { reason: "dependencies" });
}
