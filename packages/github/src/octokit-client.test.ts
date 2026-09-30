import { expect, test } from "vitest";
import { OctokitGitHub } from "./octokit-client.ts";

type Call = { method: string; url: string; body: unknown };

function fakeFetch(routes: Record<string, (body: unknown) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && new RegExp(`^${p}$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ message: `no route for ${method} ${path}` }), { status: 404, headers: { "content-type": "application/json" } });
    const r = routes[key]!(body);
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200, headers: { "content-type": "text/plain", ...r.headers } });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  };
  return { fetch, calls };
}

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
