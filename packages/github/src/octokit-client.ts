import { App, Octokit } from "octokit";
import { z } from "zod";
import {
  IssueMilestoneRefsDocument,
  IssueParentsDocument,
  PullRequestSnapshotDocument,
  RepositoryMilestonesDocument,
  SetIssueMilestoneDocument,
  type IssueMilestoneRefsQuery,
  type IssueParentsQuery,
  type PullRequestSnapshotQuery,
  type RepositoryMilestonesQuery,
  type SetIssueMilestoneMutation,
} from "./gql/graphql.ts";
import { readError } from "./errors.ts";
import { ancestorsOf, present } from "./projects/lineage.ts";
import type { Assignable, Assignee, CheckContext, GitHubPort, IssueComment, IssueDependencies, IssueDetail, IssueRef, IssueSummary, Milestone, MilestoneRef, PrInfo, PrSnapshot, RepoRef, RepoSummary } from "./types.ts";

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

/** A REST user as an assignee: the login and the avatar image. */
const toAssignee = (user: { login: string; avatar_url: string }): Assignee => ({ login: user.login, avatarUrl: user.avatar_url });

const byPushed = (a: RepoSummary, b: RepoSummary) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");

type GqlPullRequest = NonNullable<NonNullable<PullRequestSnapshotQuery["repository"]>["pullRequest"]>;
type GqlContext = NonNullable<
  NonNullable<NonNullable<NonNullable<GqlPullRequest["commits"]["nodes"]>[number]>["commit"]["statusCheckRollup"]>["contexts"]["nodes"]
>[number];

/** GitHubPort over Octokit, authenticated as a GitHub App installation or with a personal token. */
const IssueRefs = z.object({ nodes: z.array(z.object({ number: z.number().int(), state: z.string() })) });
const openNumbers = (nodes: { number: number; state: string }[]) => nodes.filter((n) => n.state === "OPEN").map((n) => n.number);

const OPEN_ISSUES = `query OpenIssues($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title url updatedAt author { login } labels(first: 20) { nodes { name } } blockedBy(first: 20) { nodes { number state } } }
    }
  }
}`;
const OpenIssuesSchema = z.object({
  repository: z.object({
    issues: z.object({
      nodes: z.array(
        z.object({
          number: z.number().int(),
          title: z.string(),
          url: z.string(),
          updatedAt: z.string(),
          author: z.object({ login: z.string() }).nullable(),
          labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
          blockedBy: IssueRefs,
        }),
      ),
    }),
  }),
});

const ISSUE_BLOCKERS = `query IssueBlockers($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { blockedBy(first: 50) { nodes { number state } } } }
}`;
const BlockersSchema = z.object({ repository: z.object({ issue: z.object({ blockedBy: IssueRefs }).nullable() }) });

export class OctokitGitHub implements GitHubPort {
  private constructor(
    private readonly clientFor: (repo: RepoRef) => Promise<Octokit>,
    private readonly tokenFor: (repo: RepoRef) => Promise<string>,
    private readonly reposFor: () => Promise<RepoSummary[]>,
    private readonly viewerFor: () => Promise<string | undefined>,
  ) {}

  /** `retry: false` turns off Octokit's retries of failed requests, for tests that answer with a 5xx. */
  static withToken(token: string, opts: { fetch?: Fetch; retry?: boolean } = {}): OctokitGitHub {
    const octokit = new Octokit({ auth: token, ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}), ...(opts.retry === false ? { retry: { enabled: false } } : {}) });
    const repos = async () =>
      (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, { sort: "pushed", per_page: 100 })).map((r) => toSummary(r as RestRepo)).sort(byPushed);
    // The token's user does not change while the process runs, so it is asked once.
    let login: Promise<string> | undefined;
    const viewer = () => {
      login ??= octokit.rest.users.getAuthenticated().then(({ data }) => data.login);
      login.catch(() => (login = undefined));
      return login;
    };
    return new OctokitGitHub(async () => octokit, async () => token, repos, viewer);
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
      // An installation acts as the App, not as a person.
      async () => undefined,
    );
  }

  listRepos(): Promise<RepoSummary[]> {
    return this.reposFor();
  }

  viewer(): Promise<string | undefined> {
    return this.viewerFor();
  }

  async listIssues(repo: RepoRef): Promise<IssueSummary[]> {
    const octokit = await this.clientFor(repo);
    // GraphQL, so each issue comes with its blockers in one call. GitHub's published schema has no issue
    // dependencies yet, so this query is checked at runtime instead of generated.
    const data = OpenIssuesSchema.parse(await octokit.graphql(OPEN_ISSUES, { owner: repo.owner, name: repo.name }));
    return data.repository.issues.nodes.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: issue.labels.nodes.map((l) => l.name),
      author: issue.author?.login ?? null,
      updatedAt: issue.updatedAt,
      blockedBy: openNumbers(issue.blockedBy.nodes),
    }));
  }

  async openBlockers(repo: RepoRef, number: number): Promise<number[]> {
    const octokit = await this.clientFor(repo);
    const data = BlockersSchema.parse(await octokit.graphql(ISSUE_BLOCKERS, { owner: repo.owner, name: repo.name, number }));
    return openNumbers(data.repository.issue?.blockedBy.nodes ?? []);
  }

  async dependencies(repo: RepoRef, number: number): Promise<IssueDependencies> {
    const octokit = await this.clientFor(repo);
    const params = { owner: repo.owner, repo: repo.name, issue_number: number, per_page: 100 };
    const [blockedBy, blocking] = await Promise.all([
      octokit.paginate(octokit.rest.issues.listDependenciesBlockedBy, params),
      octokit.paginate(octokit.rest.issues.listDependenciesBlocking, params),
    ]);
    return { blockedBy: blockedBy.map(toIssueRef), blocking: blocking.map(toIssueRef) };
  }

  async listIssueComments(repo: RepoRef, number: number): Promise<IssueComment[]> {
    const octokit = await this.clientFor(repo);
    const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner: repo.owner, repo: repo.name, issue_number: number, per_page: 100 });
    return comments.map((c) => ({
      id: c.id,
      author: c.user?.login ?? null,
      authorAssociation: c.author_association,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      body: c.body ?? "",
      url: c.html_url,
    }));
  }

  async listSubIssues(repo: RepoRef, number: number): Promise<IssueRef[]> {
    const octokit = await this.clientFor(repo);
    const subIssues = await octokit.paginate(octokit.rest.issues.listSubIssues, { owner: repo.owner, repo: repo.name, issue_number: number, per_page: 100 });
    return subIssues.map(toIssueRef);
  }

  async listAssignable(repo: RepoRef): Promise<Assignable[]> {
    const octokit = await this.clientFor(repo);
    const users = await octokit.paginate(octokit.rest.issues.listAssignees, { owner: repo.owner, repo: repo.name, per_page: 100 });
    return users.map(toAssignee);
  }

  async setAssignees(repo: RepoRef, number: number, logins: string[]): Promise<Assignee[]> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.issues.update({ owner: repo.owner, repo: repo.name, issue_number: number, assignees: logins });
    return (data.assignees ?? []).map(toAssignee);
  }

  async addBlockedBy(repo: RepoRef, issue: number, blocker: number): Promise<void> {
    const octokit = await this.clientFor(repo);
    // The endpoint takes the blocking issue's id, not its number.
    const { data } = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: blocker });
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by", { owner: repo.owner, repo: repo.name, issue_number: issue, issue_id: data.id });
  }

  async getIssue(repo: RepoRef, number: number, opts: { parents?: boolean } = {}): Promise<IssueDetail> {
    const [{ data }, parents] = await this.clientFor(repo)
      .then((octokit) =>
        Promise.all([
          octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: number }),
          opts.parents ? this.parentsOf(octokit, repo, number) : undefined,
        ]),
      )
      .catch((error: unknown) => {
        throw readError(error, `${repo.owner}/${repo.name}#${number}`);
      });
    const issue: IssueDetail = {
      number: data.number,
      title: data.title,
      url: data.html_url,
      body: data.body ?? "",
      state: data.state === "closed" ? "closed" : "open",
      stateReason: data.state_reason ?? null,
      labels: (data.labels ?? []).flatMap((l) => (typeof l === "string" ? [l] : l.name ? [l.name] : [])),
      assignees: (data.assignees ?? []).map(toAssignee),
      author: data.user?.login ?? null,
      authorAssociation: data.author_association ?? "NONE",
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pullRequest: data.pull_request != null,
    };
    return parents ? { ...issue, parents } : issue;
  }

  /** An issue's parent and grandparent through GraphQL: the sub-issue relation needs no Project access. */
  private async parentsOf(octokit: Octokit, repo: RepoRef, number: number) {
    const { repository } = await octokit.graphql<IssueParentsQuery>(IssueParentsDocument.toString(), { owner: repo.owner, name: repo.name, number });
    return repository?.issue ? ancestorsOf(repository.issue) : [];
  }

  async closeIssue(repo: RepoRef, number: number, comment: string): Promise<void> {
    const octokit = await this.clientFor(repo);
    await octokit.rest.issues.createComment({ owner: repo.owner, repo: repo.name, issue_number: number, body: comment });
    await octokit.rest.issues.update({ owner: repo.owner, repo: repo.name, issue_number: number, state: "closed", state_reason: "completed" });
  }

  async listMilestones(repo: RepoRef): Promise<Milestone[]> {
    const octokit = await this.clientFor(repo);
    const milestones: Milestone[] = [];
    let cursor: string | null | undefined;
    do {
      const data = await octokit.graphql<RepositoryMilestonesQuery>(RepositoryMilestonesDocument.toString(), { owner: repo.owner, name: repo.name, ...(cursor ? { cursor } : {}) });
      const page = data.repository?.milestones;
      milestones.push(
        ...present(page?.nodes).map((m) => ({
          number: m.number,
          title: m.title,
          description: m.description ?? "",
          // GitHub keeps a due date as a timestamp at the start of the day it names.
          dueOn: m.dueOn?.slice(0, 10) ?? undefined,
          state: m.state === "CLOSED" ? ("closed" as const) : ("open" as const),
          openIssues: m.openIssueCount,
          closedIssues: m.closedIssueCount,
          url: m.url,
        })),
      );
      cursor = page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
    } while (cursor);
    // GitHub's DUE_DATE order puts the milestones without a due date first; handoff wants them last.
    return milestones.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number - b.number);
  }

  async setMilestone(repo: RepoRef, issue: number, milestone: number | null): Promise<MilestoneRef | null> {
    const octokit = await this.clientFor(repo);
    const where = `${repo.owner}/${repo.name}`;
    let refs: IssueMilestoneRefsQuery;
    try {
      refs = await octokit.graphql<IssueMilestoneRefsQuery>(IssueMilestoneRefsDocument.toString(), {
        owner: repo.owner,
        name: repo.name,
        number: issue,
        milestone: milestone ?? 0,
        withMilestone: milestone !== null,
      });
    } catch (error) {
      // An issue number the repository lacks answers NOT_FOUND next to the rest of the data.
      const data = (error as { data?: IssueMilestoneRefsQuery | null }).data;
      if (data?.repository && !data.repository.issue) throw new Error(`issue ${where}#${issue} not found`, { cause: error });
      throw error;
    }
    const issueId = refs.repository?.issue?.id;
    if (!issueId) throw new Error(`issue ${where}#${issue} not found`);
    const milestoneId = milestone === null ? null : refs.repository?.milestone?.id;
    if (milestoneId === undefined) throw new Error(`${where} has no milestone #${milestone}`);
    const updated = await octokit.graphql<SetIssueMilestoneMutation>(SetIssueMilestoneDocument.toString(), { issueId, milestoneId });
    const kept = updated.updateIssue?.issue?.milestone;
    return kept ? { number: kept.number, title: kept.title } : null;
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string }): Promise<{ number: number; url: string }> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.issues.create({ owner: repo.owner, repo: repo.name, title: input.title, body: input.body });
    return { number: data.number, url: data.html_url };
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

  async updatePr(repo: RepoRef, number: number, input: { title: string; body: string }): Promise<void> {
    const octokit = await this.clientFor(repo);
    await octokit.rest.pulls.update({ owner: repo.owner, repo: repo.name, pull_number: number, ...input });
  }

  async expectsChecks(repo: RepoRef, branch: string): Promise<boolean> {
    const octokit = await this.clientFor(repo);
    const { data } = await octokit.rest.actions.listRepoWorkflows({ owner: repo.owner, repo: repo.name, per_page: 100 });
    if (data.workflows.some((w) => w.state === "active")) return true;
    try {
      const rules = await octokit.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", { owner: repo.owner, repo: repo.name, branch });
      return (rules.data as { type: string }[]).some((r) => r.type === "required_status_checks");
    } catch {
      // Rules need a newer plan or permission on some repositories; without them, workflows decide.
      return false;
    }
  }

  async listPrFiles(repo: RepoRef, number: number): Promise<string[]> {
    const octokit = await this.clientFor(repo);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner: repo.owner, repo: repo.name, pull_number: number, per_page: 100 });
    return files.map((f) => f.filename);
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
      reviews: present(pr.reviews?.nodes).map((r) => ({
        id: String(r.databaseId ?? ""),
        state: r.state,
        body: r.body,
        author: r.author?.login ?? "ghost",
        commitSha: r.commit?.oid ?? null,
        submittedAt: r.submittedAt ?? null,
      })),
      reviewThreads: present(pr.reviewThreads.nodes).map((t) => ({
        isResolved: t.isResolved,
        comments: present(t.comments.nodes).map((c) => ({
          ...(c.databaseId ? { id: String(c.databaseId) } : {}),
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

  async getFile(repo: RepoRef, path: string, ref: string): Promise<string | undefined> {
    const octokit = await this.clientFor(repo);
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return undefined;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
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

  async behindBy(repo: RepoRef, base: string, head: string) {
    const octokit = await this.clientFor(repo);
    // Compared from the head: the commits the base has on top are how far the head is behind.
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({ owner: repo.owner, repo: repo.name, basehead: `${head}...${base}`, per_page: 1 });
    return data.ahead_by;
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

function toIssueRef(issue: { number: number; title: string; html_url: string; state: string }): IssueRef {
  return { number: issue.number, title: issue.title, url: issue.html_url, state: issue.state === "closed" ? "closed" : "open" };
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
