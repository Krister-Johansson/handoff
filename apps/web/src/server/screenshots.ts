import { eq, screenshots, type Db } from "@handoff/db";

/** Where a screenshot's file is, when the screenshot exists. */
export async function screenshotPath(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db.select({ path: screenshots.path }).from(screenshots).where(eq(screenshots.id, id));
  return row?.path;
}
