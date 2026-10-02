import { expect, test } from "vitest";
import { OctokitGitHub } from "./octokit-client.ts";
import { fakeFetch } from "./testing/fake-fetch.ts";

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

test("getPrSnapshot maps the GraphQL pull request, rollup and review threads", async () => {
  const { fetch } = fakeFetch({
    "POST /graphql": () => ({
      json: {
        data: {
          repository: {
            pullRequest: {
              number: 7,
              title: "Add a changelog",
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
  expect(snap).toMatchObject({ number: 7, headSha: "abc", state: "open", reviewDecision: "CHANGES_REQUESTED", title: "Add a changelog", additions: 12, deletions: 3, changedFiles: 1, draft: false });
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

test("getIssue reads an issue with its body", async () => {
  const { fetch } = fakeFetch({
    "GET /repos/octo/sample/issues/12": () => ({ json: { number: 12, title: "Slugify drops digits", html_url: "https://github.com/octo/sample/issues/12", body: null, state: "open" } }),
  });
  const gh = OctokitGitHub.withToken("t", { fetch });
  expect(await gh.getIssue(repo, 12)).toEqual({ number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "", state: "open" });
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
