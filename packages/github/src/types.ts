export type RepoRef = { owner: string; name: string; installationId?: number | null | undefined };

export type PrInfo = { number: number; url: string; headSha: string };

export type CheckContext = {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  checkRunId?: number;
};

export type PrSnapshot = {
  number: number;
  title: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  url: string;
  headSha: string;
  headRef: string;
  state: "open" | "closed" | "merged";
  merged: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** statusCheckRollup of the head commit; null when no checks have reported yet. */
  checks: { state: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | string; contexts: CheckContext[] } | null;
  reviewThreads: { isResolved: boolean; comments: { author: string; body: string; path?: string; line?: number; url: string }[] }[];
  comments: { author: string; body: string; url: string }[];
};

/** Everything the engine needs from GitHub. OctokitGitHub in production, FakeGitHub in tests. */
export interface GitHubPort {
  getRepoId(repo: RepoRef): Promise<number>;
  findPrByHead(repo: RepoRef, branch: string): Promise<PrInfo | undefined>;
  createPr(repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo>;
  getPrSnapshot(repo: RepoRef, number: number): Promise<PrSnapshot>;
  getJobLogTail(repo: RepoRef, jobId: number, lines?: number): Promise<string | undefined>;
  mergePr(repo: RepoRef, number: number, method?: "squash" | "merge" | "rebase"): Promise<{ merged: boolean; sha?: string }>;
  /** Updates the PR comment whose body contains `marker`, or creates it. */
  upsertPrComment(repo: RepoRef, number: number, marker: string, body: string): Promise<{ id: number; created: boolean }>;
  /**
   * Environment variables (GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n, GIT_CONFIG_VALUE_n) that authenticate git
   * over https for this repository. Environment, not `-c` argv, so the token never appears in git's
   * "Command failed" error messages or in the process list.
   */
  gitAuthEnv(repo: RepoRef): Promise<Record<string, string>>;
}
