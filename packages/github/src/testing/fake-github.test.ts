import { expect, test } from "vitest";
import { FakeGitHub } from "./fake-github.ts";

const repo = { owner: "octo", name: "sample" };
const url = (n: number) => `https://github.com/octo/sample/issues/${n}`;

/** A FakeGitHub with open issues by number and title. */
function github(issues: Record<number, string>) {
  const fake = new FakeGitHub();
  for (const [n, title] of Object.entries(issues)) fake.issues.set(Number(n), { number: Number(n), title, url: url(Number(n)), body: "", state: "open" });
  return fake;
}

test("getIssue gives the facts a test set and GitHub's defaults for the rest", async () => {
  const fake = github({ 16: "Drag and drop" });
  Object.assign(fake.issues.get(16)!, { labels: ["task"], assignees: ["ann"], author: "cat", createdAt: "2026-09-30T10:00:00Z" });
  expect(await fake.getIssue(repo, 16)).toEqual({
    number: 16,
    title: "Drag and drop",
    url: url(16),
    body: "",
    state: "open",
    stateReason: null,
    labels: ["task"],
    assignees: ["ann"],
    author: "cat",
    authorAssociation: "NONE",
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
    pullRequest: false,
  });
});

test("getIssue answers a pull request's number as a pull request, an unknown number as not found, and nothing while GitHub is unreachable", async () => {
  const fake = github({ 16: "Drag and drop" });
  const pr = await fake.createPr(repo, { head: "b", base: "main", title: "Add drag", body: "" });
  expect(await fake.getIssue(repo, pr.number + 100).catch((e: unknown) => e)).toMatchObject({ name: "GitHubReadError", reason: "not-found" });
  fake.issues.delete(16);
  expect(await fake.getIssue(repo, pr.number)).toMatchObject({ number: pr.number, title: "Add drag", pullRequest: true });

  fake.issues.set(16, { number: 16, title: "Drag and drop", url: url(16), body: "", state: "open" });
  fake.unreachable = true;
  expect(await fake.getIssue(repo, 16).catch((e: unknown) => e)).toMatchObject({ name: "GitHubReadError", reason: "unreachable" });
});

test("dependencies lists the blockers an issue records and the issues that record it as theirs", async () => {
  const fake = github({ 8: "Theme switch", 16: "Drag and drop", 88: "Reorder", 145: "Restyle columns" });
  fake.issues.get(8)!.state = "closed";
  fake.issues.get(16)!.blockedBy = [145, 8];
  fake.issues.get(88)!.blockedBy = [16];
  expect(await fake.dependencies(repo, 16)).toEqual({
    blockedBy: [
      { number: 145, title: "Restyle columns", url: url(145), state: "open" },
      { number: 8, title: "Theme switch", url: url(8), state: "closed" },
    ],
    blocking: [{ number: 88, title: "Reorder", url: url(88), state: "open" }],
  });
});

test("listIssueComments lists the comments a test adds, oldest first", async () => {
  const fake = github({ 16: "Drag and drop" });
  fake.comment(16, "ann", "First notes", { at: "2026-10-01T22:17:00Z", association: "OWNER" });
  fake.comment(16, "bob", "More notes", { at: "2026-10-01T22:28:00Z" });
  expect(await fake.listIssueComments(repo, 16)).toEqual([
    { id: 1, author: "ann", authorAssociation: "OWNER", createdAt: "2026-10-01T22:17:00Z", updatedAt: "2026-10-01T22:17:00Z", body: "First notes", url: `${url(16)}#issuecomment-1` },
    { id: 2, author: "bob", authorAssociation: "NONE", createdAt: "2026-10-01T22:28:00Z", updatedAt: "2026-10-01T22:28:00Z", body: "More notes", url: `${url(16)}#issuecomment-2` },
  ]);
  expect(await fake.listIssueComments(repo, 88)).toEqual([]);
});

test("viewer is the token's user, undefined as a GitHub App, and setAssignees keeps only people who can be assigned", async () => {
  const fake = github({ 16: "Drag and drop" });
  expect(await fake.viewer()).toBe("octocat");
  fake.login = undefined;
  expect(await fake.viewer()).toBeUndefined();

  fake.assignable = [{ login: "ann", avatarUrl: "https://avatars/ann" }];
  expect(await fake.listAssignable(repo)).toEqual([{ login: "ann", avatarUrl: "https://avatars/ann" }]);
  expect(await fake.setAssignees(repo, 16, ["ann", "stranger"])).toEqual(["ann"]);
  expect((await fake.getIssue(repo, 16)).assignees).toEqual(["ann"]);
  expect(fake.assigned).toEqual([{ number: 16, logins: ["ann"] }]);
  expect(await fake.setAssignees(repo, 16, [])).toEqual([]);
});

test("listSubIssues lists the sub-issues in the order they became sub-issues, as GitHub keeps them", async () => {
  const fake = github({ 16: "Drag and drop", 88: "Reorder", 132: "Board interactions" });
  fake.parents.set(88, 132);
  fake.parents.set(16, 132);
  expect((await fake.listSubIssues(repo, 132)).map((i) => i.number)).toEqual([88, 16]);
});
