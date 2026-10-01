import { execFileSync } from "node:child_process";
import type { GitHubPort, IssueDetail, IssueSummary, PrInfo, PrSnapshot, RepoRef, RepoSummary } from "../types.ts";

type FakePr = PrSnapshot & { base: string; body: string };

/** In-memory GitHub for engine tests. Tests mutate PR state directly to simulate CI and reviews. */
export class FakeGitHub implements GitHubPort {
  readonly prs = new Map<number, FakePr>();
  readonly jobLogs = new Map<number, string>();
  readonly merged: number[] = [];
  repoId = 42;
  repos: RepoSummary[] = [];
  readonly closedIssues: { number: number; comment: string }[] = [];
  readonly issues = new Map<number, IssueDetail & Partial<IssueSummary>>();
  private next = 1;

  async listIssues(_repo: RepoRef): Promise<IssueSummary[]> {
    return [...this.issues.values()]
      .filter((i) => i.state === "open")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .map((i) => ({ number: i.number, title: i.title, url: i.url, labels: i.labels ?? [], author: i.author ?? null, updatedAt: i.updatedAt ?? "" }));
  }

  async getIssue(_repo: RepoRef, number: number): Promise<IssueDetail> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`no issue ${number}`);
    return { number: issue.number, title: issue.title, url: issue.url, body: issue.body, state: issue.state };
  }

  async closeIssue(_repo: RepoRef, number: number, comment: string) {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`no issue ${number}`);
    issue.state = "closed";
    this.closedIssues.push({ number, comment });
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
      headSha: "sha-1",
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

  async getJobLogTail(_repo: RepoRef, jobId: number) {
    return this.jobLogs.get(jobId);
  }

  async mergePr(_repo: RepoRef, number: number) {
    const pr = this.prs.get(number);
    if (!pr || pr.state !== "open" || pr.mergeable === "CONFLICTING") return { merged: false };
    pr.state = "merged";
    pr.merged = true;
    this.merged.push(number);
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
