import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { assignableUsers, tokenUser } from "./assignees.ts";
import { createProject } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("me on the Plan is the token's user; nobody with a GitHub App, without GitHub, or when GitHub does not answer", async () => {
  const github = new FakeGitHub();
  expect(await tokenUser(github)).toBe("octocat");
  github.login = undefined;
  expect(await tokenUser(github)).toBeUndefined();
  expect(await tokenUser(undefined)).toBeUndefined();
  github.viewer = async () => {
    throw new Error("Bad credentials");
  };
  expect(await tokenUser(github)).toBeUndefined();
});

test("the people who can be assigned list the token's user first, marked as you", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const github = new FakeGitHub();
  github.assignable = [
    { login: "ann", avatarUrl: "a1" },
    { login: "octocat", avatarUrl: "a2" },
  ];
  expect(await assignableUsers(db, github, project.id)).toEqual({
    repo: "octo/sample",
    users: [
      { login: "octocat", avatarUrl: "a2", you: true },
      { login: "ann", avatarUrl: "a1", you: false },
    ],
  });
  github.login = undefined;
  expect((await assignableUsers(db, github, project.id)).users.map((u) => u.you)).toEqual([false, false]);
  await expect(assignableUsers(db, undefined, project.id)).rejects.toThrow("GitHub access");
});
