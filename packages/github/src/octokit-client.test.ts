import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { expect, test } from "vitest";
import { OctokitGitHub } from "./octokit-client.ts";
import { fakeFetch, fakeGraphql, GraphqlErrors } from "./testing/fake-fetch.ts";

const repo = { owner: "octo", name: "sample" };

test("findPrByHead returns the open PR for a branch", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /repos/octo/sample/pulls": () => ({ json: [{ number: 7, html_url: "https://github.com/octo/sample/pull/7", head: { sha: "abc", ref: "handoff/x" } }] }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.findPrByHead(repo, "handoff/x")).toEqual({ number: 7, url: "https://github.com/octo/sample/pull/7", headSha: "abc" });
  expect(new URL(calls[0]!.url).searchParams.get("head")).toBe("octo:handoff/x");
});

test("createPr posts title, body, head and base", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /repos/octo/sample/pulls": () => ({ status: 201, json: { number: 8, html_url: "https://github.com/octo/sample/pull/8", head: { sha: "def", ref: "b" } } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  const pr = await gh.createPr(repo, { head: "b", base: "main", title: "T", body: "B" });
  expect(pr.number).toBe(8);
  expect(calls[0]!.body).toEqual({ head: "b", base: "main", title: "T", body: "B" });
});

test("updatePr patches the title and body of a pull request", async () => {
  const { fetch, calls } = fakeFetch({
    "PATCH /repos/octo/sample/pulls/8": () => ({ json: { number: 8, html_url: "https://github.com/octo/sample/pull/8", head: { sha: "def", ref: "b" } } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  await gh.updatePr(repo, 8, { title: "T2", body: "B2" });
  expect(calls[0]!.body).toEqual({ title: "T2", body: "B2" });
});

test("expectsChecks is true when the repository has an active workflow or the branch requires status checks", async () => {
  const none = fakeFetch({
    "GET /repos/octo/sample/actions/workflows": () => ({ json: { total_count: 1, workflows: [{ id: 1, state: "disabled_manually" }] } }),
    "GET /repos/octo/sample/rules/branches/main": () => ({ json: [{ type: "pull_request" }] }),
  });
  expect(await OctokitGitHub.withToken("t", { fetch: none.fetch }).expectsChecks(repo, "main")).toBe(false);
  const workflow = fakeFetch({
    "GET /repos/octo/sample/actions/workflows": () => ({ json: { total_count: 1, workflows: [{ id: 1, state: "active" }] } }),
    "GET /repos/octo/sample/rules/branches/main": () => ({ json: [] }),
  });
  expect(await OctokitGitHub.withToken("t", { fetch: workflow.fetch }).expectsChecks(repo, "main")).toBe(true);
  const required = fakeFetch({
    "GET /repos/octo/sample/actions/workflows": () => ({ json: { total_count: 0, workflows: [] } }),
    "GET /repos/octo/sample/rules/branches/main": () => ({ json: [{ type: "required_status_checks" }] }),
  });
  expect(await OctokitGitHub.withToken("t", { fetch: required.fetch }).expectsChecks(repo, "main")).toBe(true);
});

test("getPrSnapshot maps the GraphQL pull request, its description, rollup and review threads", async () => {
  const { fetch } = fakeFetch({
    "POST /graphql": () => ({
      json: {
        data: {
          repository: {
            pullRequest: {
              number: 7,
              title: "Add a changelog",
              body: "Adds CHANGELOG.md.\n\nCloses #12",
              isDraft: false,
              additions: 12,
              deletions: 3,
              changedFiles: 1,
              updatedAt: "2026-09-30T10:00:00Z",
              url: "https://github.com/octo/sample/pull/7",
              headRefOid: "abc",
              headRefName: "handoff/x",
              state: "OPEN",
              merged: false,
              mergeable: "MERGEABLE",
              reviewDecision: "CHANGES_REQUESTED",
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        state: "FAILURE",
                        contexts: {
                          nodes: [
                            { __typename: "CheckRun", databaseId: 5, name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://gh/x/job/5" },
                            { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: "u" },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
              reviewThreads: {
                nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: "ann" }, body: "rename", path: "a.ts", line: 3, url: "u1" }] } }],
              },
              comments: { nodes: [{ author: { login: "cat" }, body: "tests?", url: "u3" }] },
            },
          },
        },
      },
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  const snap = await gh.getPrSnapshot(repo, 7);
  expect(snap).toMatchObject({ number: 7, headSha: "abc", state: "open", reviewDecision: "CHANGES_REQUESTED", title: "Add a changelog", body: "Adds CHANGELOG.md.\n\nCloses #12", additions: 12, deletions: 3, changedFiles: 1, draft: false });
  expect(snap.checks).toEqual({
    state: "FAILURE",
    contexts: [
      { name: "test", status: "COMPLETED", conclusion: "FAILURE", url: "https://gh/x/job/5", checkRunId: 5 },
      { name: "ci/legacy", status: "COMPLETED", conclusion: "SUCCESS", url: "u" },
    ],
  });
  expect(snap.reviewThreads[0]!.comments[0]).toEqual({ author: "ann", body: "rename", path: "a.ts", line: 3, url: "u1" });
});

test("getJobLogTail returns the last lines of an Actions job log and undefined when unavailable", async () => {
  const log = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/actions/jobs/5/logs": () => ({ text: log }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  const tail = await gh.getJobLogTail(repo, 5, 50);
  expect(tail?.split("\n")).toHaveLength(50);
  expect(tail?.endsWith("line 299")).toBe(true);
  expect(await gh.getJobLogTail(repo, 6, 50)).toBeUndefined();
});

test("mergePr squashes by default and reports the merge sha", async () => {
  const { fetch, calls } = fakeFetch({
    "PUT /repos/octo/sample/pulls/7/merge": () => ({ json: { merged: true, sha: "m1" } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.mergePr(repo, 7)).toEqual({ merged: true, sha: "m1" });
  expect(calls[0]!.body).toMatchObject({ merge_method: "squash" });
});

test("gitAuthEnv passes the extraheader to git through GIT_CONFIG_* variables, not argv", async () => {
  const gh = OctokitGitHub.withToken("tok", { fetch: fakeFetch({}).fetch });
  expect(await gh.gitAuthEnv(repo)).toEqual({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from("x-access-token:tok").toString("base64")}`,
  });
});

test("upsertPrComment updates the comment that carries the marker", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /repos/octo/sample/issues/7/comments": () => ({ json: [{ id: 1, body: "LGTM" }, { id: 5, body: "<!-- handoff:x -->\nold" }] }),
    "PATCH /repos/octo/sample/issues/comments/5": () => ({ json: { id: 5 } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.upsertPrComment(repo, 7, "<!-- handoff:x -->", "<!-- handoff:x -->\nnew")).toEqual({ id: 5, created: false });
  expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { body: "<!-- handoff:x -->\nnew" } });
});

test("upsertPrComment creates the comment when none carries the marker", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /repos/octo/sample/issues/7/comments": () => ({ json: [{ id: 1, body: "LGTM" }] }),
    "POST /repos/octo/sample/issues/7/comments": () => ({ status: 201, json: { id: 9 } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.upsertPrComment(repo, 7, "<!-- handoff:x -->", "<!-- handoff:x -->\nnotes")).toEqual({ id: 9, created: true });
  expect(calls.at(-1)).toMatchObject({ method: "POST", body: { body: "<!-- handoff:x -->\nnotes" } });
});

test("listRepos with a token lists the user's repositories, most recently pushed first", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /user/repos": () => ({
      json: [
        { id: 1, name: "sample", full_name: "octo/sample", owner: { login: "octo" }, default_branch: "main", private: true, description: "A sample", pushed_at: "2026-09-29T10:00:00Z", archived: false },
        { id: 2, name: "old", full_name: "octo/old", owner: { login: "octo" }, default_branch: "master", private: false, description: null, pushed_at: "2026-01-01T10:00:00Z", archived: true },
      ],
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.listRepos()).toEqual([
    { id: 1, owner: "octo", name: "sample", fullName: "octo/sample", defaultBranch: "main", private: true, description: "A sample", pushedAt: "2026-09-29T10:00:00Z", archived: false },
    { id: 2, owner: "octo", name: "old", fullName: "octo/old", defaultBranch: "master", private: false, description: null, pushedAt: "2026-01-01T10:00:00Z", archived: true },
  ]);
  const url = new URL(calls[0]!.url);
  expect(url.searchParams.get("sort")).toBe("pushed");
  expect(url.searchParams.get("per_page")).toBe("100");
});

test("listIssues lists open issues, most recently updated first, each with the open issues GitHub says block it", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /graphql": () => ({
      json: {
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  number: 12,
                  title: "Slugify drops digits",
                  url: "https://github.com/octo/sample/issues/12",
                  updatedAt: "2026-09-30T08:00:00Z",
                  author: { login: "ann" },
                  labels: { nodes: [{ name: "bug" }, { name: "p1" }] },
                  blockedBy: { nodes: [{ number: 3, state: "CLOSED" }, { number: 5, state: "OPEN" }] },
                },
              ],
            },
          },
        },
      },
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.listIssues(repo)).toEqual([
    { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", labels: ["bug", "p1"], author: "ann", updatedAt: "2026-09-30T08:00:00Z", blockedBy: [5] },
  ]);
  expect(calls[0]!.body).toMatchObject({ variables: { owner: "octo", name: "sample" } });
  expect((calls[0]!.body as { query: string }).query).toContain("blockedBy");
});

test("openBlockers reads an issue's open blocked-by issues", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /graphql": () => ({ json: { data: { repository: { issue: { blockedBy: { nodes: [{ number: 3, state: "OPEN" }, { number: 4, state: "CLOSED" }] } } } } } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.openBlockers(repo, 6)).toEqual([3]);
  expect(calls[0]!.body).toMatchObject({ variables: { owner: "octo", name: "sample", number: 6 } });
});

test("addBlockedBy links the blocking issue by its id", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /repos/octo/sample/issues/3": () => ({ json: { id: 9003, number: 3, title: "F03", html_url: "u", state: "open" } }),
    "POST /repos/octo/sample/issues/6/dependencies/blocked_by": () => ({ status: 201, json: { id: 9003 } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  await gh.addBlockedBy(repo, 6, 3);
  expect(calls.at(-1)).toMatchObject({ method: "POST", body: { issue_id: 9003 } });
});

test("behindBy counts the base branch's commits the head does not have", async () => {
  const { fetch, calls } = fakeFetch({ "GET /repos/octo/sample/compare/.+": () => ({ json: { ahead_by: 2, behind_by: 0 } }) });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.behindBy(repo, "main", "abc123")).toBe(2);
  expect(new URL(calls[0]!.url).pathname).toBe("/repos/octo/sample/compare/abc123...main");
});

test("getIssue reads an issue with its body, labels, assignees with their avatars, author and times", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/12": () => ({
      json: {
        number: 12,
        title: "Slugify drops digits",
        html_url: "https://github.com/octo/sample/issues/12",
        body: null,
        state: "closed",
        state_reason: "completed",
        labels: [{ name: "task" }, "bug"],
        assignees: [{ login: "ann", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" }, { login: "bob", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" }],
        user: { login: "cat" },
        author_association: "OWNER",
        created_at: "2026-09-30T10:00:00Z",
        updated_at: "2026-10-01T12:00:00Z",
      },
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.getIssue(repo, 12)).toEqual({
    number: 12,
    title: "Slugify drops digits",
    url: "https://github.com/octo/sample/issues/12",
    body: "",
    state: "closed",
    stateReason: "completed",
    labels: ["task", "bug"],
    assignees: [
      { login: "ann", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      { login: "bob", avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4" },
    ],
    author: "cat",
    authorAssociation: "OWNER",
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    pullRequest: false,
    milestone: null,
  });
});

test("getIssue reads the issue's own milestone by number and title", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/57": () => ({
      json: {
        number: 57,
        title: "Milestone picker",
        html_url: "https://github.com/octo/sample/issues/57",
        body: "",
        state: "open",
        labels: ["task"],
        milestone: { number: 3, title: "0.9", state: "open", due_on: "2026-10-20T07:00:00Z", html_url: "https://github.com/octo/sample/milestone/3" },
      },
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect((await gh.getIssue(repo, 57)).milestone).toEqual({ number: 3, title: "0.9" });
});

test("getIssue tells a pull request's number from an issue's", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/7": () => ({
      json: { number: 7, title: "Add a changelog", html_url: "https://github.com/octo/sample/pull/7", body: "", state: "open", pull_request: { url: "https://api.github.com/repos/octo/sample/pulls/7" } },
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.getIssue(repo, 7)).toMatchObject({ number: 7, pullRequest: true });
});

test("getIssue tells a number GitHub does not know from GitHub not answering", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/999": () => ({ status: 404, json: { message: "Not Found" } }),
    "GET /repos/octo/sample/issues/16": () => ({ status: 502, json: { message: "Bad gateway" } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch, retry: false });
  await expect(gh.getIssue(repo, 999)).rejects.toMatchObject({ name: "GitHubReadError", reason: "not-found" });
  await expect(gh.getIssue(repo, 16)).rejects.toMatchObject({ name: "GitHubReadError", reason: "unreachable" });
  const offline = OctokitGitHub.withToken("t", {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    retry: false,
  });
  await expect(offline.getIssue(repo, 16)).rejects.toMatchObject({ name: "GitHubReadError", reason: "unreachable" });
});

const restIssue = (number: number, title: string, state = "open") => ({ number, title, html_url: `https://github.com/octo/sample/issues/${number}`, state });

test("dependencies reads the issues blocking an issue and those it blocks, open or closed", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/16/dependencies/blocked_by": () => ({ json: [restIssue(145, "Restyle board columns"), restIssue(15, "Move menu", "closed")] }),
    "GET /repos/octo/sample/issues/16/dependencies/blocking": () => ({ json: [restIssue(88, "Reorder subtasks")] }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.dependencies(repo, 16)).toEqual({
    blockedBy: [
      { number: 145, title: "Restyle board columns", url: "https://github.com/octo/sample/issues/145", state: "open" },
      { number: 15, title: "Move menu", url: "https://github.com/octo/sample/issues/15", state: "closed" },
    ],
    blocking: [{ number: 88, title: "Reorder subtasks", url: "https://github.com/octo/sample/issues/88", state: "open" }],
  });
});

test("listIssueComments reads an issue's comments oldest first with author, association and time", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /repos/octo/sample/issues/16/comments": () => ({
      json: [
        {
          id: 1,
          user: { login: "ann" },
          author_association: "OWNER",
          created_at: "2026-10-01T22:17:00Z",
          updated_at: "2026-10-01T22:20:00Z",
          body: "Notes from the review.",
          html_url: "https://github.com/octo/sample/issues/16#issuecomment-1",
        },
        { id: 2, user: null, author_association: "NONE", created_at: "2026-10-02T00:17:00Z", updated_at: "2026-10-02T00:17:00Z", body: null, html_url: "u2" },
      ],
    }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.listIssueComments(repo, 16)).toEqual([
    {
      id: 1,
      author: "ann",
      authorAssociation: "OWNER",
      createdAt: "2026-10-01T22:17:00Z",
      updatedAt: "2026-10-01T22:20:00Z",
      body: "Notes from the review.",
      url: "https://github.com/octo/sample/issues/16#issuecomment-1",
    },
    { id: 2, author: null, authorAssociation: "NONE", createdAt: "2026-10-02T00:17:00Z", updatedAt: "2026-10-02T00:17:00Z", body: "", url: "u2" },
  ]);
  expect(new URL(calls[0]!.url).searchParams.get("per_page")).toBe("100");
});

test("viewer is the login of the token's user, and undefined for a GitHub App, which has no user", async () => {
  const { fetch } = fakeFetch({ "GET /user": () => ({ json: { login: "Krister-Johansson", id: 1 } }) });
  expect(await OctokitGitHub.withToken("t", { fetch }).viewer()).toBe("Krister-Johansson");

  const app = fakeFetch({});
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  expect(await OctokitGitHub.withApp({ appId: 1, privateKey, fetch: app.fetch }).viewer()).toBeUndefined();
  expect(app.calls).toEqual([]);
});

test("listAssignable lists who can be assigned issues in the repository, with their avatars", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/assignees": () => ({ json: [{ login: "ann", avatar_url: "https://avatars.githubusercontent.com/u/1" }, { login: "bob", avatar_url: "https://avatars.githubusercontent.com/u/2" }] }),
  });
  expect(await OctokitGitHub.withToken("t", { fetch }).listAssignable(repo)).toEqual([
    { login: "ann", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
    { login: "bob", avatarUrl: "https://avatars.githubusercontent.com/u/2" },
  ]);
});

test("setAssignees replaces an issue's assignees and returns those GitHub kept, with their avatars", async () => {
  const { fetch, calls } = fakeFetch({
    "PATCH /repos/octo/sample/issues/16": (body) => ({ json: { number: 16, assignees: (body as { assignees: string[] }).assignees.map((login) => ({ login, avatar_url: `https://avatars.githubusercontent.com/${login}` })) } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.setAssignees(repo, 16, ["ann"])).toEqual([{ login: "ann", avatarUrl: "https://avatars.githubusercontent.com/ann" }]);
  expect(await gh.setAssignees(repo, 16, [])).toEqual([]);
  expect(calls.map((c) => c.body)).toEqual([{ assignees: ["ann"] }, { assignees: [] }]);
});

test("listSubIssues reads an issue's sub-issues in GitHub's order", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/132/sub_issues": () => ({ json: [restIssue(88, "Reorder subtasks"), restIssue(16, "Drag and drop", "closed")] }),
  });
  expect(await OctokitGitHub.withToken("t", { fetch }).listSubIssues(repo, 132)).toEqual([
    { number: 88, title: "Reorder subtasks", url: "https://github.com/octo/sample/issues/88", state: "open" },
    { number: 16, title: "Drag and drop", url: "https://github.com/octo/sample/issues/16", state: "closed" },
  ]);
});

test("getIssue reads the parent chain when asked", async () => {
  const labels = (...names: string[]) => ({ nodes: names.map((name) => ({ name })) });
  const { fetch, operations } = fakeGraphql(
    {
      IssueParents: () => ({
        repository: {
          issue: {
            parent: {
              number: 41,
              title: "Shaping with the assistant",
              body: "Stories have acceptance criteria.",
              labels: labels("story"),
              issueType: null,
              parent: { number: 12, title: "Project management", body: "Plan on GitHub Projects.", labels: labels(), issueType: { name: "Epic" }, parent: null },
            },
          },
        },
      }),
    },
    {
      "GET /repos/octo/sample/issues/57": () => ({
        json: { number: 57, title: "Add the migration", html_url: "https://github.com/octo/sample/issues/57", body: "Task body.", state: "open" },
      }),
    },
  );
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.getIssue(repo, 57, { parents: true })).toMatchObject({
    number: 57,
    title: "Add the migration",
    url: "https://github.com/octo/sample/issues/57",
    body: "Task body.",
    state: "open",
    parents: [
      { number: 41, title: "Shaping with the assistant", body: "Stories have acceptance criteria.", kind: "story" },
      { number: 12, title: "Project management", body: "Plan on GitHub Projects.", kind: "epic" },
    ],
  });
  expect(operations).toEqual([{ operation: "IssueParents", variables: { owner: "octo", name: "sample", number: 57 } }]);
});

test("closeIssue comments on the issue and closes it as completed", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /repos/octo/sample/issues/12/comments": () => ({ status: 201, json: { id: 1 } }),
    "PATCH /repos/octo/sample/issues/12": () => ({ json: { number: 12, state: "closed" } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  await gh.closeIssue(repo, 12, "Fixed by #7.");
  expect(calls.map((c) => [c.method, new URL(c.url).pathname, c.body])).toEqual([
    ["POST", "/repos/octo/sample/issues/12/comments", { body: "Fixed by #7." }],
    ["PATCH", "/repos/octo/sample/issues/12", { state: "closed", state_reason: "completed" }],
  ]);
});

test("getFile reads a file's text on a branch, and is undefined when the file is not there", async () => {
  const { fetch, calls } = fakeFetch({
    // Octokit sends the path with its slash encoded, as GitHub accepts.
    "GET /repos/octo/sample/contents/.claude%2Flaunch.json": () => ({ json: { type: "file", encoding: "base64", content: Buffer.from('{"version":"0.0.1"}').toString("base64") } }),
    "GET /repos/octo/sample/contents/src": () => ({ json: [{ type: "file", name: "a.ts" }] }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.getFile(repo, ".claude/launch.json", "main")).toBe('{"version":"0.0.1"}');
  expect(new URL(calls[0]!.url).searchParams.get("ref")).toBe("main");
  expect(await gh.getFile(repo, "CLAUDE.md", "main")).toBeUndefined();
  // A folder is not a file.
  expect(await gh.getFile(repo, "src", "main")).toBeUndefined();
});

const githubSchema = buildSchema(readFileSync(new URL("./schema/schema.docs.graphql", import.meta.url), "utf8"), { assumeValid: true });
/** The errors GitHub's published schema finds in the GraphQL documents a fake fetch received. */
const schemaErrors = (calls: { url: string; body: unknown }[]) =>
  calls.filter((c) => new URL(c.url).pathname === "/graphql").flatMap((c) => validate(githubSchema, parse((c.body as { query: string }).query)).map((e) => e.message));

/** A milestone node as GitHub's GraphQL answers it. */
const milestoneNode = (number: number, title: string, over: Record<string, unknown> = {}) => ({
  number,
  title,
  description: null,
  dueOn: null,
  state: "OPEN",
  openIssueCount: 0,
  closedIssueCount: 0,
  url: `https://github.com/octo/sample/milestone/${number}`,
  ...over,
});

test("listMilestones reads the repository's open and closed milestones across pages, the dated ones by due date first", async () => {
  const page = (nodes: unknown[], endCursor: string | null) => ({ repository: { milestones: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } } });
  const { fetch, operations, calls } = fakeGraphql({
    RepositoryMilestones: (v) =>
      v.cursor
        ? page([milestoneNode(4, "Redesign beta", { dueOn: "2026-10-03T00:00:00Z", openIssueCount: 4, closedIssueCount: 2 })], null)
        : page(
            [
              milestoneNode(1, "0.8", { state: "CLOSED", dueOn: "2026-09-01T07:00:00Z", description: "The first cut.", closedIssueCount: 9 }),
              milestoneNode(2, "Someday"),
              milestoneNode(3, "0.9", { dueOn: "2026-10-20T00:00:00Z", openIssueCount: 6, closedIssueCount: 3 }),
            ],
            "c1",
          ),
  });

  const milestones = await OctokitGitHub.withToken("t", { fetch }).listMilestones(repo);

  expect(milestones).toEqual([
    { number: 1, title: "0.8", description: "The first cut.", dueOn: "2026-09-01", state: "closed", openIssues: 0, closedIssues: 9, url: "https://github.com/octo/sample/milestone/1" },
    { number: 4, title: "Redesign beta", description: "", dueOn: "2026-10-03", state: "open", openIssues: 4, closedIssues: 2, url: "https://github.com/octo/sample/milestone/4" },
    { number: 3, title: "0.9", description: "", dueOn: "2026-10-20", state: "open", openIssues: 6, closedIssues: 3, url: "https://github.com/octo/sample/milestone/3" },
    // A milestone without a due date comes after the dated ones.
    { number: 2, title: "Someday", description: "", dueOn: undefined, state: "open", openIssues: 0, closedIssues: 0, url: "https://github.com/octo/sample/milestone/2" },
  ]);
  expect(operations).toEqual([
    { operation: "RepositoryMilestones", variables: { owner: "octo", name: "sample" } },
    { operation: "RepositoryMilestones", variables: { owner: "octo", name: "sample", cursor: "c1" } },
  ]);
  expect(schemaErrors(calls)).toEqual([]);
});

/** setMilestone's two requests: the issue's and the milestone's node ids, then updateIssue answering the milestone it set. */
function milestoneWrites(milestones: Record<number, { id: string; title: string }>) {
  return fakeGraphql({
    IssueMilestoneRefs: (v) => ({ repository: { issue: { id: `I_${v.number}` }, ...(v.withMilestone ? { milestone: milestones[v.milestone as number] ?? null } : {}) } }),
    SetIssueMilestone: (v) => {
      const found = Object.entries(milestones).find(([, m]) => m.id === v.milestoneId);
      return { updateIssue: { issue: { milestone: found ? { number: Number(found[0]), title: found[1].title } : null } } };
    },
  });
}

test("setMilestone sets an issue's milestone through updateIssue and returns the milestone GitHub kept", async () => {
  const { fetch, operations, calls } = milestoneWrites({ 3: { id: "MI_3", title: "0.9" } });

  expect(await OctokitGitHub.withToken("t", { fetch }).setMilestone(repo, 12, 3)).toEqual({ number: 3, title: "0.9" });

  expect(operations).toEqual([
    { operation: "IssueMilestoneRefs", variables: { owner: "octo", name: "sample", number: 12, milestone: 3, withMilestone: true } },
    { operation: "SetIssueMilestone", variables: { issueId: "I_12", milestoneId: "MI_3" } },
  ]);
  expect(schemaErrors(calls)).toEqual([]);
});

test("setMilestone with null clears the issue's milestone", async () => {
  const { fetch, operations, calls } = milestoneWrites({ 3: { id: "MI_3", title: "0.9" } });

  expect(await OctokitGitHub.withToken("t", { fetch }).setMilestone(repo, 12, null)).toBeNull();

  expect(operations).toEqual([
    { operation: "IssueMilestoneRefs", variables: { owner: "octo", name: "sample", number: 12, milestone: 0, withMilestone: false } },
    // An explicit null, which updateIssue reads as no milestone; a missing key would leave the milestone as it is.
    { operation: "SetIssueMilestone", variables: { issueId: "I_12", milestoneId: null } },
  ]);
  expect(schemaErrors(calls)).toEqual([]);
});

test("setMilestone refuses a milestone or an issue the repository does not have, and writes nothing", async () => {
  const { fetch, operations } = milestoneWrites({ 3: { id: "MI_3", title: "0.9" } });
  await expect(OctokitGitHub.withToken("t", { fetch }).setMilestone(repo, 12, 7)).rejects.toThrow("octo/sample has no milestone #7");

  const missing = fakeGraphql({
    IssueMilestoneRefs: () =>
      new GraphqlErrors({ repository: { issue: null, milestone: { id: "MI_3" } } }, [{ type: "NOT_FOUND", path: ["repository", "issue"], message: "Could not resolve to an Issue with the number of 99." }]),
  });
  await expect(OctokitGitHub.withToken("t", { fetch: missing.fetch }).setMilestone(repo, 99, 3)).rejects.toThrow("issue octo/sample#99 not found");

  expect([...operations, ...missing.operations].map((o) => o.operation)).not.toContain("SetIssueMilestone");
});
