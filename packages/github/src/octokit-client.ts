import { App, Octokit } from "octokit";
import type { GitHubPort, PrInfo, PrSnapshot, RepoRef } from "./types.ts";

type Fetch = typeof globalThis.fetch;

const PR_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number url headRefOid headRefName state merged mergeable reviewDecision
      commits(last: 1) { nodes { commit { statusCheckRollup {
        state
        contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { databaseId name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } }
      } } } }
      reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { author { login } body path line url } } } }
      comments(last: 50) { nodes { author { login } body url } }
    }
  }
}`;

type GqlAuthor = { login: string } | null;
type GqlPullRequest = {
  number: number;
  url: string;
  headRefOid: string;
  headRefName: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  merged: boolean;
  mergeable: string;
  reviewDecision: PrSnapshot["reviewDecision"];
  commits: { nodes: { commit: { statusCheckRollup: { state: string; contexts: { nodes: GqlContext[] } } | null } }[] };
  reviewThreads: {
    nodes: { isResolved: boolean; comments: { nodes: { author: GqlAuthor; body: string; path: string | null; line: number | null; url: string }[] } }[];
  };
  comments: { nodes: { author: GqlAuthor; body: string; url: string }[] };
};

type GqlContext =
  | { __typename: "CheckRun"; databaseId: number; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

/** GitHubPort over Octokit, authenticated as a GitHub App installation or with a personal token. */
export class OctokitGitHub implements GitHubPort {
  private constructor(
    private readonly clientFor: (repo: RepoRef) => Promise<Octokit>,
    private readonly tokenFor: (repo: RepoRef) => Promise<string>,
  ) {}

  static withToken(token: string, opts: { fetch?: Fetch } = {}): OctokitGitHub {
    const octokit = new Octokit({ auth: token, ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}) });
    return new OctokitGitHub(async () => octokit, async () => token);
  }

  static withApp(input: { appId: number; privateKey: string; fetch?: Fetch }): OctokitGitHub {
    const app = new App({
      appId: input.appId,
      privateKey: input.privateKey,
      ...(input.fetch ? { Octokit: Octokit.defaults({ request: { fetch: input.fetch } }) } : {}),
    });
    const installation = async (repo: RepoRef) => {
      if (repo.installationId) return repo.installationId;
      const { data } = await app.octokit.rest.apps.getRepoInstallation({ owner: repo.owner, repo: repo.name });
      return data.id;
    };
    return new OctokitGitHub(
      async (repo) => app.getInstallationOctokit(await installation(repo)),
      async (repo) => {
        const octokit = await app.getInstallationOctokit(await installation(repo));
        const auth = (await octokit.auth({ type: "installation" })) as { token: string };
        return auth.token;
      },
    );
  }

  async getRepoId(repo: RepoRef): Promise<number> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.repos.get({ owner: repo.owner, repo: repo.name });
    return data.id;
  }

  async findPrByHead(repo: RepoRef, branch: string): Promise<PrInfo | undefined> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.pulls.list({ owner: repo.owner, repo: repo.name, head: `${repo.owner}:${branch}`, state: "open" });
    const pr = data[0];
    return pr ? { number: pr.number, url: pr.html_url, headSha: pr.head.sha } : undefined;
  }

  async createPr(repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.pulls.create({ owner: repo.owner, repo: repo.name, ...input });
    return { number: data.number, url: data.html_url, headSha: data.head.sha };
  }

  async getPrSnapshot(repo: RepoRef, number: number): Promise<PrSnapshot> {
    const octokit = await this.clientFor(repo);
    const { repository } = await octokit.graphql<{ repository: { pullRequest: GqlPullRequest } }>(PR_QUERY, {
      owner: repo.owner,
      name: repo.name,
      number,
    });
    const pr = repository.pullRequest;
    const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup ?? null;
    return {
      number: pr.number,
      url: pr.url,
      headSha: pr.headRefOid,
      headRef: pr.headRefName,
      state: pr.merged ? "merged" : pr.state === "OPEN" ? "open" : "closed",
      merged: pr.merged,
      mergeable: pr.mergeable,
      reviewDecision: pr.reviewDecision ?? null,
      checks: rollup
        ? {
            state: rollup.state,
            contexts: rollup.contexts.nodes.map((c) =>
              c.__typename === "CheckRun"
                ? { name: c.name, status: c.status, conclusion: c.conclusion, url: c.detailsUrl ?? "", checkRunId: c.databaseId }
                : { name: c.context, status: "COMPLETED", conclusion: c.state === "PENDING" ? null : c.state, url: c.targetUrl ?? "" },
            ),
          }
        : null,
      reviewThreads: pr.reviewThreads.nodes.map((t) => ({
        isResolved: t.isResolved,
        comments: t.comments.nodes.map((c) => ({
          author: c.author?.login ?? "ghost",
          body: c.body,
          ...(c.path ? { path: c.path } : {}),
          ...(typeof c.line === "number" ? { line: c.line } : {}),
          url: c.url,
        })),
      })),
      comments: pr.comments.nodes.map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, url: c.url })),
    };
  }

  async getJobLogTail(repo: RepoRef, jobId: number, lines = 120): Promise<string | undefined> {
    const octokit = await this.clientFor(repo);
    try {
      const response = await octokit.request("GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs", {
        owner: repo.owner,
        repo: repo.name,
        job_id: jobId,
      });
      const text = typeof response.data === "string" ? response.data : String(response.data ?? "");
      return text.replace(/\r/g, "").trimEnd().split("\n").slice(-lines).join("\n");
    } catch {
      return undefined;
    }
  }

  async mergePr(repo: RepoRef, number: number, method: "squash" | "merge" | "rebase" = "squash") {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.pulls.merge({ owner: repo.owner, repo: repo.name, pull_number: number, merge_method: method });
    return { merged: data.merged, ...(data.sha ? { sha: data.sha } : {}) };
  }

  async gitAuthConfig(repo: RepoRef): Promise<string[]> {
    const token = await this.tokenFor(repo);
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
  }
}
