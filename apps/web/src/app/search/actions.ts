"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { LAST_PROJECT_COOKIE } from "@/lib/last-project";
import type { SearchRecords, SearchTasks } from "@/lib/search/types";
import { searchRecords, searchTasks, type SearchScope } from "@/server/search";

const ScopeSchema = z.object({ projectId: z.string().uuid().optional().catch(undefined), all: z.boolean().optional().catch(undefined) });

/** The project search covers: the one asked for, else the one used last in this browser. */
async function scopeOf(input: unknown): Promise<SearchScope & { all?: boolean }> {
  const parsed = ScopeSchema.safeParse(input ?? {});
  const { projectId, all } = parsed.success ? parsed.data : {};
  const lastProjectId = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
  return { projectId, lastProjectId, ...(all ? { all } : {}) };
}

/**
 * What search shows at once when the dialog opens: the projects, the latest runs of each and the chats.
 * `projectId` is the project of the open page; without one, search covers the project used last.
 */
export async function searchRecordsAction(input: { projectId?: string }): Promise<SearchRecords> {
  return searchRecords(getDb(), await scopeOf(input));
}

/**
 * The tasks search finds, read when the dialog opens and never per keystroke: the project's, or every
 * project's with `all`. GitHub is read at most once a minute per project; when it fails, the tasks come
 * from the runs' issues and the source says why.
 */
export async function searchTasksAction(input: { projectId?: string; all?: boolean }): Promise<SearchTasks> {
  return searchTasks(getDb(), getGitHub(), getProjects(), await scopeOf(input));
}
