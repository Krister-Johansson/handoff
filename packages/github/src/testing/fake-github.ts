import { execFileSync } from "node:child_process";
import { kindOf } from "../projects/kinds.ts";
import type { PlanAncestor } from "../projects/types.ts";
import { GitHubReadError } from "../errors.ts";
import type { Assignable, Assignee, GitHubPort, IssueComment, IssueDependencies, IssueDetail, IssueRef, IssueSummary, PrInfo, PrSnapshot, RepoRef, RepoSummary } from "../types.ts";

type FakePr = PrSnapshot & { base: string; body: string; files?: string[] };

/**
 * An issue of the fake: what every issue has, and any of GitHub's other facts a test wants to set.
 * Assignees are logins; the reads give each one an avatar.
 */
export type FakeIssue = Pick<IssueDetail, "number" | "title" | "url" | "body" | "state"> &
  Partial<Omit<IssueDetail, "number" | "title" | "url" | "body" | "state" | "parents" | "assignees">> &
  Partial<Pick<IssueSummary, "blockedBy">> & { assignees?: string[] };

/** An issue as getIssue gives it, with GitHub's defaults for the facts a test left out. */
function detailOf(issue: FakeIssue, person: (login: string) => Assignee): IssueDetail {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason ?? (issue.state === "closed" ? "completed" : null),
    labels: [...(issue.labels ?? [])],
    assignees: (issue.assignees ?? []).map(person),
    author: issue.author ?? null,
    authorAssociation: issue.authorAssociation ?? "NONE",
    createdAt: issue.createdAt ?? issue.updatedAt ?? "",
    updatedAt: issue.updatedAt ?? issue.createdAt ?? "",
    pullRequest: issue.pullRequest ?? false,
  };
}

/** In-memory GitHub for engine tests. Tests mutate PR state directly to simulate CI and reviews. */
export class FakeGitHub implements GitHubPort {
  readonly prs = new Map<number, FakePr>();
  readonly jobLogs = new Map<number, string>();
  readonly merged: number[] = [];
  /** How far a pull request (by number) is behind its base, reported once: the next compare finds it caught up. */
  readonly behind = new Map<number, number>();
  repoId = 42;
  repos: RepoSummary[] = [];
  readonly closedIssues: { number: number; comment: string }[] = [];
  /** Issues by number: a test sets what it needs, and getIssue fills the rest with GitHub's defaults. */
  readonly issues = new Map<number, FakeIssue>();
  /** Comments by issue number, oldest first; `comment` adds one. */
  readonly comments = new Map<number, IssueComment[]>();
  /** The token's user; undefined acts as a GitHub App, which has no user. */
  login: string | undefined = "octocat";
  /** Who can be assigned issues in the repository. */
  assignable: Assignable[] = [{ login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231" }];
  /** Every setAssignees call, with the assignees it kept. */
  readonly assigned: { number: number; logins: string[] }[] = [];
  /** While true, issue reads fail as though GitHub did not answer. */
  unreachable = false;
  private nextComment = 1;
  /** Parent issue number by issue number: GitHub's sub-issue relation. */
  readonly parents = new Map<number, number>();
  /** Files on the default branch, by path. */
  readonly files = new Map<string, string>();
  private next = 1;

  async getFile(_repo: RepoRef, path: string, _ref: string): Promise<string | undefined> {
    return this.files.get(path);
  }

  async listIssues(_repo: RepoRef): Promise<IssueSummary[]> {
    return [...this.issues.values()]
      .filter((i) => i.state === "open")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .map((i) => ({ number: i.number, title: i.title, url: i.url, labels: i.labels ?? [], author: i.author ?? null, updatedAt: i.updatedAt ?? "", blockedBy: this.openOf(i.blockedBy) }));
  }

  /** The blockers that are still open; an issue the fake does not know counts as open. */
  private openOf(numbers: number[] | undefined) {
    return (numbers ?? []).filter((n) => this.issues.get(n)?.state !== "closed");
  }

  async openBlockers(_repo: RepoRef, number: number) {
    return this.openOf(this.issues.get(number)?.blockedBy);
  }

  async addBlockedBy(_repo: RepoRef, issue: number, blocker: number) {
    const found = this.issues.get(issue);
    if (!found) throw new Error(`no issue ${issue}`);
    found.blockedBy = [...new Set([...(found.blockedBy ?? []), blocker])];
  }

  async getIssue(_repo: RepoRef, number: number, opts: { parents?: boolean } = {}): Promise<IssueDetail> {
    if (this.unreachable) throw new GitHubReadError("unreachable", `GitHub did not answer for #${number}.`);
    const issue = this.issues.get(number);
    const pr = issue ? undefined : this.prs.get(number);
    if (pr) return { ...detailOf({ number, title: pr.title, url: pr.url, body: pr.body, state: pr.state === "open" ? "open" : "closed", updatedAt: pr.updatedAt }, (login) => this.person(login)), pullRequest: true };
    if (!issue) throw new GitHubReadError("not-found", `no issue ${number}`);
    return { ...detailOf(issue, (login) => this.person(login)), ...(opts.parents ? { parents: this.ancestorsOf(number) } : {}) };
  }

  async dependencies(_repo: RepoRef, number: number): Promise<IssueDependencies> {
    const ref = (n: number): IssueRef[] => {
      const found = this.issues.get(n);
      return found ? [{ number: n, title: found.title, url: found.url, state: found.state }] : [];
    };
    const blocking = [...this.issues.values()].filter((i) => i.blockedBy?.includes(number)).map((i) => i.number);
    return { blockedBy: (this.issues.get(number)?.blockedBy ?? []).flatMap(ref), blocking: blocking.flatMap(ref) };
  }

  async listIssueComments(_repo: RepoRef, number: number): Promise<IssueComment[]> {
    return structuredClone(this.comments.get(number) ?? []);
  }

  /** Adds a comment to an issue, as a person would on GitHub. */
  comment(number: number, author: string, body: string, opts: { at?: string; association?: string } = {}) {
    const id = this.nextComment++;
    const at = opts.at ?? new Date().toISOString();
    const url = `${this.issues.get(number)?.url ?? `https://github.com/octo/sample/issues/${number}`}#issuecomment-${id}`;
    this.comments.set(number, [...(this.comments.get(number) ?? []), { id, author, authorAssociation: opts.association ?? "NONE", createdAt: at, updatedAt: at, body, url }]);
  }

  async viewer(): Promise<string | undefined> {
    return this.login;
  }

  async listSubIssues(_repo: RepoRef, number: number): Promise<IssueRef[]> {
    return [...this.parents].flatMap(([child, parent]) => {
      const found = parent === number ? this.issues.get(child) : undefined;
      return found ? [{ number: child, title: found.title, url: found.url, state: found.state }] : [];
    });
  }

  async listAssignable(_repo: RepoRef): Promise<Assignable[]> {
    return structuredClone(this.assignable);
  }

  /** A login with its avatar: the one `assignable` lists for it, else one made from the login. */
  person(login: string): Assignee {
    return { login, avatarUrl: this.assignable.find((a) => a.login === login)?.avatarUrl ?? `https://avatars.githubusercontent.com/${login}` };
  }

  async setAssignees(_repo: RepoRef, number: number, logins: string[]): Promise<Assignee[]> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`no issue ${number}`);
    // GitHub drops a login it cannot assign rather than failing.
    const kept = logins.filter((login) => this.assignable.some((a) => a.login === login));
    issue.assignees = kept;
    this.assigned.push({ number, logins: kept });
    return kept.map((login) => this.person(login));
  }

  /** The parent and the grandparent of an issue, nearest first, with their kinds as GitHub would tell them. */
  ancestorsOf(issue: number): PlanAncestor[] {
    const ancestors: PlanAncestor[] = [];
    for (let p = this.parents.get(issue); p !== undefined && ancestors.length < 2; p = this.parents.get(p)) {
      const found = this.issues.get(p);
      if (!found) break;
      ancestors.push({ number: p, title: found.title, body: found.body, kind: kindOf(found.labels ?? [], undefined, this.depthOf(p)) });
    }
    return ancestors;
  }

  /** How many ancestors an issue has, counted up to three. */
  depthOf(issue: number): number {
    let depth = 0;
    for (let p = this.parents.get(issue); p !== undefined && depth < 3; p = this.parents.get(p)) depth++;
    return depth;
  }

  async closeIssue(_repo: RepoRef, number: number, comment: string) {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`no issue ${number}`);
    issue.state = "closed";
    this.closedIssues.push({ number, comment });
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string }) {
    const number = Math.max(0, ...this.issues.keys(), ...this.prs.keys()) + 1;
    const url = `https://github.com/${repo.owner}/${repo.name}/issues/${number}`;
    this.issues.set(number, { number, title: input.title, url, body: input.body, state: "open", updatedAt: new Date().toISOString() });
    return { number, url };
  }

  async listRepos() {
    return structuredClone(this.repos);
  }

  async getRepoId(_repo: RepoRef) {
    return this.repoId;
  }

  /** Whether the fake repository runs CI on pull requests; false for one with no workflows or required checks. */
  ciConfigured = true;

  async expectsChecks(_repo: RepoRef, _branch: string): Promise<boolean> {
    return this.ciConfigured;
  }

  async findPrByHead(_repo: RepoRef, branch: string): Promise<PrInfo | undefined> {
    const pr = [...this.prs.values()].find((p) => p.headRef === branch && p.state === "open");
    return pr ? { number: pr.number, url: pr.url, headSha: pr.headSha } : undefined;
  }

  async createPr(_repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo> {
    const number = this.next++;
    const pr: FakePr = {
      number,
      title: input.title,
      draft: false,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      updatedAt: new Date().toISOString(),
      url: `https://github.com/octo/sample/pull/${number}`,
      headSha: `sha-${number}`,
      headRef: input.head,
      base: input.base,
      body: input.body,
      state: "open",
      merged: false,
      mergeable: "MERGEABLE",
      reviewDecision: null,
      checks: { state: "PENDING", contexts: [] },
      reviews: [],
      reviewThreads: [],
      comments: [],
    };
    this.prs.set(number, pr);
    return { number, url: pr.url, headSha: pr.headSha };
  }

  async updatePr(_repo: RepoRef, number: number, input: { title: string; body: string }): Promise<void> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR #${number}`);
    pr.title = input.title;
    pr.body = input.body;
  }

  /** A local origin repository: when set, a PR's head follows its branch there, as a push moves it on GitHub. */
  origin: string | undefined;

  async getPrSnapshot(_repo: RepoRef, number: number): Promise<PrSnapshot> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    if (this.origin) {
      try {
        pr.headSha = execFileSync("git", ["-C", this.origin, "rev-parse", `refs/heads/${pr.headRef}`], { encoding: "utf8" }).trim();
      } catch {
        // The branch is not in the origin (yet): keep the head the PR was opened with.
      }
    }
    return structuredClone(pr);
  }

  async listPrFiles(_repo: RepoRef, number: number): Promise<string[]> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    return [...(pr.files ?? [])];
  }

  async getJobLogTail(_repo: RepoRef, jobId: number) {
    return this.jobLogs.get(jobId);
  }

  async behindBy(_repo: RepoRef, _base: string, head: string) {
    const pr = [...this.prs.values()].find((p) => p.headSha === head);
    if (!pr) return 0;
    const n = this.behind.get(pr.number) ?? 0;
    this.behind.delete(pr.number);
    return n;
  }

  /**
   * Whether a merge closes the open issues the pull request's body names with "Closes #N", as GitHub does
   * on a merge into the default branch. Off by default, since GitHub does not always do it.
   */
  closesOnMerge = false;

  async mergePr(_repo: RepoRef, number: number) {
    const pr = this.prs.get(number);
    if (!pr || pr.state !== "open" || pr.mergeable === "CONFLICTING") return { merged: false };
    pr.state = "merged";
    pr.merged = true;
    this.merged.push(number);
    if (this.closesOnMerge) {
      for (const [, n] of pr.body.matchAll(/^Closes #(\d+)$/gm)) {
        const issue = this.issues.get(Number(n));
        if (issue) issue.state = "closed";
      }
    }
    return { merged: true, sha: `merge-${number}` };
  }

  async upsertPrComment(_repo: RepoRef, number: number, marker: string, body: string) {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    const index = pr.comments.findIndex((c) => c.body.includes(marker));
    if (index >= 0) {
      pr.comments[index] = { ...pr.comments[index]!, body };
      return { id: index + 1, created: false };
    }
    pr.comments.push({ author: "handoff", body, url: `${pr.url}#issuecomment-${pr.comments.length + 1}` });
    return { id: pr.comments.length, created: true };
  }

  async gitAuthEnv(): Promise<Record<string, string>> {
    return {};
  }

  /** Test helpers */
  setChecks(number: number, state: "SUCCESS" | "FAILURE" | "PENDING", failed: { name: string; jobId: number; log?: string }[] = []) {
    const pr = this.prs.get(number)!;
    pr.checks = {
      state,
      contexts: failed.map((f) => ({ name: f.name, status: "COMPLETED", conclusion: "FAILURE", url: `https://ci/${f.jobId}`, checkRunId: f.jobId })),
    };
    for (const f of failed) if (f.log) this.jobLogs.set(f.jobId, f.log);
  }

  /**
   * A review on the PR's current head commit, the way a review bot such as CodeRabbit leaves one:
   * a summary body and unresolved inline threads, usually with state COMMENTED.
   */
  reviewOnHead(
    number: number,
    author: string,
    review: { state?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED"; body?: string; threads?: { path: string; line?: number; body: string }[] } = {},
  ) {
    const pr = this.prs.get(number)!;
    const id = String(this.next++ * 1000);
    pr.reviews.push({ id, state: review.state ?? "COMMENTED", body: review.body ?? "", author, commitSha: pr.headSha, submittedAt: new Date().toISOString() });
    pr.reviewThreads.push(
      ...(review.threads ?? []).map((t, i) => ({ isResolved: false, comments: [{ id: `${id}-${i}`, author, body: t.body, path: t.path, ...(t.line ? { line: t.line } : {}), url: `https://review/${number}#${id}-${i}` }] })),
    );
    return id;
  }

  review(number: number, decision: "APPROVED" | "CHANGES_REQUESTED", comments: { author: string; body: string; path?: string; line?: number }[] = []) {
    const pr = this.prs.get(number)!;
    pr.reviewDecision = decision;
    pr.reviewThreads.push(...comments.map((c) => ({ isResolved: false, comments: [{ ...c, url: `https://review/${number}` }] })));
  }
}
