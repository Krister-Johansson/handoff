"use server";

import { revalidatePath } from "next/cache";
import { suggestProjectName } from "@handoff/core";
import { importSkillRepository, type RepoImportReport } from "@handoff/engine/library-import";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";

export type RepoImportState = { report?: RepoImportReport; error?: string; repo?: string };

const REPO = /^[\w.-]+\/[\w.-]+$/;

/** Imports every skill in a GitHub repository and groups them; GitHub access, if configured, covers private repositories. */
export async function importRepoAction(_: RepoImportState, form: FormData): Promise<RepoImportState> {
  const repo = String(form.get("repo") ?? "")
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  if (!REPO.test(repo)) return { error: "Give the repository as owner/name, for example anthropics/skills.", repo };
  const [owner, name] = repo.split("/") as [string, string];
  const group = String(form.get("group") ?? "").trim() || suggestProjectName(`${owner}-${name}`, []);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(group)) return { error: "Group name: lowercase letters, digits and dashes.", repo };
  const gitEnv = (await getGitHub()?.gitAuthEnv({ owner, name }).catch(() => undefined)) ?? {};
  try {
    const report = await importSkillRepository(getDb(), { repo, group, gitEnv });
    revalidatePath("/settings");
    return { report, repo };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0], repo };
  }
}
