import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createProject } from "./graphs.ts";
import { suggestProjectName } from "../lib/project-name.ts";
import { listAvailableRepos } from "./repos.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = (owner: string, name: string, defaultBranch = "main") => ({
  id: name.length,
  owner,
  name,
  fullName: `${owner}/${name}`,
  defaultBranch,
  private: false,
  description: null,
  pushedAt: null,
  archived: false,
});

test("listAvailableRepos marks repositories that already are projects", async () => {
  const github = new FakeGitHub();
  github.repos = [repo("octo", "sample"), repo("Octo", "Other", "trunk")];
  await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const repos = await listAvailableRepos(db, github);
  expect(repos).toEqual([
    expect.objectContaining({ fullName: "octo/sample", project: "sandbox" }),
    expect.objectContaining({ fullName: "Octo/Other", defaultBranch: "trunk", project: null }),
  ]);
});

test("suggestProjectName turns a repository name into a valid, unused project name", async () => {
  expect(suggestProjectName("My_Repo.js", [])).toBe("my-repo-js");
  expect(suggestProjectName("sample", ["sample"])).toBe("sample-2");
  expect(suggestProjectName("--", [])).toBe("project");
});
