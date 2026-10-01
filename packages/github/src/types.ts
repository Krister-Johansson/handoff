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
  /** Submitted reviews, newest last: who reviewed which commit, with what verdict and summary. */
  reviews: { id: string; state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | string; body: string; author: string; commitSha: string | null; submittedAt: string | null }[];
  reviewThreads: { isResolved: boolean; comments: { id?: string; author: string; body: string; path?: string; line?: number; url: string }[] }[];
  comments: { author: string; body: string; url: string }[];
};

/** Everything the engine needs from GitHub. OctokitGitHub in production, FakeGitHub in tests. */
/** A repository the configured credential can reach, for picking a project's repository. */
export type RepoSummary = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  pushedAt: string | null;
  archived: boolean;
};

export type IssueSummary = { number: number; title: string; url: string; labels: string[]; author: string | null; updatedAt: string };
export type IssueDetail = { number: number; title: string; url: string; body: string; state: "open" | "closed" };

export interface GitHubPort {
  /** Open issues of a repository (not pull requests), most recently updated first, up to 100. */
  listIssues(repo: RepoRef): Promise<IssueSummary[]>;
  getIssue(repo: RepoRef, number: number): Promise<IssueDetail>;
  /** Comments on an issue, then closes it as completed. */
  closeIssue(repo: RepoRef, number: number, comment: string): Promise<void>;
  /** Repositories this credential can reach, most recently pushed first. */
  listRepos(): Promise<RepoSummary[]>;
  getRepoId(repo: RepoRef): Promise<number>;
  findPrByHead(repo: RepoRef, branch: string): Promise<PrInfo | undefined>;
  createPr(repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo>;
  /** Replaces a pull request's title and description. */
  updatePr(repo: RepoRef, number: number, input: { title: string; body: string }): Promise<void>;
  getPrSnapshot(repo: RepoRef, number: number): Promise<PrSnapshot>;
  /** Whether checks will ever run on a pull request into `branch`: an active Actions workflow, or a branch rule that requires status checks. */
  expectsChecks(repo: RepoRef, branch: string): Promise<boolean>;
  getJobLogTail(repo: RepoRef, jobId: number, lines?: number): Promise<string | undefined>;
  mergePr(repo: RepoRef, number: number, method?: "squash" | "merge" | "rebase"): Promise<{ merged: boolean; sha?: string }>;
  /** How many commits `base` has that `head` does not: 0 when the head is up to date with it. */
  behindBy(repo: RepoRef, base: string, head: string): Promise<number>;
  /** Updates the PR comment whose body contains `marker`, or creates it. */
  upsertPrComment(repo: RepoRef, number: number, marker: string, body: string): Promise<{ id: number; created: boolean }>;
  /**
   * Environment variables (GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n, GIT_CONFIG_VALUE_n) that authenticate git
   * over https for this repository. Environment, not `-c` argv, so the token never appears in git's
   * "Command failed" error messages or in the process list.
   */
  gitAuthEnv(repo: RepoRef): Promise<Record<string, string>>;
}
