import { App, Octokit } from "octokit";
import { PullRequestSnapshotDocument, type PullRequestSnapshotQuery } from "./gql/graphql.ts";
import type { CheckContext, GitHubPort, IssueDetail, IssueSummary, PrInfo, PrSnapshot, RepoRef, RepoSummary } from "./types.ts";

type Fetch = typeof globalThis.fetch;

type RestRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch?: string;
  private: boolean;
  description: string | null;
  pushed_at?: string | null;
  archived?: boolean;
};

const toSummary = (r: RestRepo): RepoSummary => ({
  id: r.id,
  owner: r.owner.login,
  name: r.name,
  fullName: r.full_name,
  defaultBranch: r.default_branch ?? "main",
  private: r.private,
  description: r.description,
  pushedAt: r.pushed_at ?? null,
  archived: r.archived ?? false,
});

const byPushed = (a: RepoSummary, b: RepoSummary) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");

type GqlPullRequest = NonNullable<NonNullable<PullRequestSnapshotQuery["repository"]>["pullRequest"]>;
type GqlContext = NonNullable<
  NonNullable<NonNullable<NonNullable<GqlPullRequest["commits"]["nodes"]>[number]>["commit"]["statusCheckRollup"]>["contexts"]["nodes"]
>[number];

/** GitHubPort over Octokit, authenticated as a GitHub App installation or with a personal token. */
export class OctokitGitHub implements GitHubPort {
  private constructor(
    private readonly clientFor: (repo: RepoRef) => Promise<Octokit>,
    private readonly tokenFor: (repo: RepoRef) => Promise<string>,
    private readonly reposFor: () => Promise<RepoSummary[]>,
  ) {}

  static withToken(token: string, opts: { fetch?: Fetch } = {}): OctokitGitHub {
    const octokit = new Octokit({ auth: token, ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}) });
    const repos = async () =>
      (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, { sort: "pushed", per_page: 100 })).map((r) => toSummary(r as RestRepo)).sort(byPushed);
    return new OctokitGitHub(async () => octokit, async () => token, repos);
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
      async () => {
        const repos: RepoSummary[] = [];
        for await (const { repository } of app.eachRepository.iterator()) repos.push(toSummary(repository as RestRepo));
        return repos.sort(byPushed);
      },
    );
  }

  listRepos(): Promise<RepoSummary[]> {
    return this.reposFor();
  }

  async listIssues(repo: RepoRef): Promise<IssueSummary[]> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.issues.listForRepo({ owner: repo.owner, repo: repo.name, state: "open", sort: "updated", direction: "desc", per_page: 100 });
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        labels: issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        author: issue.user?.login ?? null,
        updatedAt: issue.updated_at,
      }));
  }

  async getIssue(repo: RepoRef, number: number): Promise<IssueDetail> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: number });
    return { number: data.number, title: data.title, url: data.html_url, body: data.body ?? "", state: data.state === "closed" ? "closed" : "open" };
  }

  async closeIssue(repo: RepoRef, number: number, comment: string): Promise<void> {
    const octokit = await this.clientFor(repo);
    await octokit.rest.issues.createComment({ owner: repo.owner, repo: repo.name, issue_number: number, body: comment });
    await octokit.rest.issues.update({ owner: repo.owner, repo: repo.name, issue_number: number, state: "closed", state_reason: "completed" });
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
    const { repository } = await octokit.graphql<PullRequestSnapshotQuery>(PullRequestSnapshotDocument.toString(), {
      owner: repo.owner,
      name: repo.name,
      number,
    });
    const pr = repository?.pullRequest;
    if (!pr) throw new Error(`pull request ${repo.owner}/${repo.name}#${number} not found`);
    const rollup = pr.commits.nodes?.[0]?.commit.statusCheckRollup ?? null;
    const present = <T>(items: readonly (T | null | undefined)[] | null | undefined): T[] => (items ?? []).filter((x): x is T => x != null);
    return {
      number: pr.number,
      title: pr.title,
      draft: pr.isDraft,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      updatedAt: pr.updatedAt,
      url: pr.url,
      headSha: pr.headRefOid,
      headRef: pr.headRefName,
      state: pr.merged ? "merged" : pr.state === "OPEN" ? "open" : "closed",
      merged: pr.merged,
      mergeable: pr.mergeable,
      reviewDecision: pr.reviewDecision ?? null,
      checks: rollup
        ? { state: rollup.state, contexts: present<NonNullable<GqlContext>>(rollup.contexts.nodes).flatMap((c) => toCheckContext(c)) }
        : null,
      reviewThreads: present(pr.reviewThreads.nodes).map((t) => ({
        isResolved: t.isResolved,
        comments: present(t.comments.nodes).map((c) => ({
          author: c.author?.login ?? "ghost",
          body: c.body,
          ...(c.path ? { path: c.path } : {}),
          ...(typeof c.line === "number" ? { line: c.line } : {}),
          url: c.url,
        })),
      })),
      comments: present(pr.comments.nodes).map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, url: c.url })),
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

  async upsertPrComment(repo: RepoRef, number: number, marker: string, body: string) {
    const octokit = await this.clientFor(repo);
    const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner: repo.owner, repo: repo.name, issue_number: number, per_page: 100 });
    const existing = comments.find((c) => c.body?.includes(marker));
    if (existing) {
      await octokit.rest.issues.updateComment({ owner: repo.owner, repo: repo.name, comment_id: existing.id, body });
      return { id: existing.id, created: false };
    }
    const { data } = await octokit.rest.issues.createComment({ owner: repo.owner, repo: repo.name, issue_number: number, body });
    return { id: data.id, created: true };
  }

  async gitAuthEnv(repo: RepoRef): Promise<Record<string, string>> {
    const token = await this.tokenFor(repo);
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
  }
}

function toCheckContext(c: NonNullable<GqlContext>): CheckContext[] {
  if (c.__typename === "CheckRun") {
    return [{ name: c.name, status: c.status, conclusion: c.conclusion ?? null, url: c.detailsUrl ?? "", ...(c.databaseId ? { checkRunId: c.databaseId } : {}) }];
  }
  if (c.__typename === "StatusContext") {
    return [{ name: c.context, status: "COMPLETED", conclusion: c.state === "PENDING" || c.state === "EXPECTED" ? null : c.state, url: c.targetUrl ?? "" }];
  }
  return [];
}
