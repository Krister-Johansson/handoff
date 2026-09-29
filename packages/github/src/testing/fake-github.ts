import type { GitHubPort, PrInfo, PrSnapshot, RepoRef } from "../types.ts";

type FakePr = PrSnapshot & { base: string; title: string; body: string };

/** In-memory GitHub for engine tests. Tests mutate PR state directly to simulate CI and reviews. */
export class FakeGitHub implements GitHubPort {
  readonly prs = new Map<number, FakePr>();
  readonly jobLogs = new Map<number, string>();
  readonly merged: number[] = [];
  repoId = 42;
  private next = 1;

  async getRepoId(_repo: RepoRef) {
    return this.repoId;
  }

  async findPrByHead(_repo: RepoRef, branch: string): Promise<PrInfo | undefined> {
    const pr = [...this.prs.values()].find((p) => p.headRef === branch && p.state === "open");
    return pr ? { number: pr.number, url: pr.url, headSha: pr.headSha } : undefined;
  }

  async createPr(_repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo> {
    const number = this.next++;
    const pr: FakePr = {
      number,
      url: `https://github.com/octo/sample/pull/${number}`,
      headSha: "sha-1",
      headRef: input.head,
      base: input.base,
      title: input.title,
      body: input.body,
      state: "open",
      merged: false,
      mergeable: "MERGEABLE",
      reviewDecision: null,
      checks: { state: "PENDING", contexts: [] },
      reviewThreads: [],
      comments: [],
    };
    this.prs.set(number, pr);
    return { number, url: pr.url, headSha: pr.headSha };
  }

  async getPrSnapshot(_repo: RepoRef, number: number): Promise<PrSnapshot> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
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

  async gitAuthConfig() {
    return [];
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

  review(number: number, decision: "APPROVED" | "CHANGES_REQUESTED", comments: { author: string; body: string; path?: string; line?: number }[] = []) {
    const pr = this.prs.get(number)!;
    pr.reviewDecision = decision;
    pr.reviewThreads.push(...comments.map((c) => ({ isResolved: false, comments: [{ ...c, url: `https://review/${number}` }] })));
  }
}
