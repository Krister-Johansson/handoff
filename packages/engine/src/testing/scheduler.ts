import { eq, projectSchedulers, sql, type Db } from "@handoff/db";

/**
 * Turns the project's scheduler on as if it last checked 30 seconds ago, with the next check 30
 * seconds away. `due()` is the seconds from now to the next check, rounded: 0 after a nudge.
 */
export async function schedulerOn(db: Db, projectId: string) {
  await db.insert(projectSchedulers).values({
    projectId,
    enabled: true,
    graphName: "g",
    lastCheckAt: sql`now() - interval '30 seconds'`,
    nextCheckAt: sql`now() + interval '30 seconds'`,
  });
  const due = async () => {
    const [row] = await db
      .select({ s: sql<number>`round(extract(epoch from ${projectSchedulers.nextCheckAt} - now()))::int` })
      .from(projectSchedulers)
      .where(eq(projectSchedulers.projectId, projectId));
    return row!.s;
  };
  /** Puts the next check 30 seconds away again, as after a check, to see the next nudge. */
  const reset = () => db.update(projectSchedulers).set({ nextCheckAt: sql`now() + interval '30 seconds'` }).where(eq(projectSchedulers.projectId, projectId));
  return { due, reset };
}
