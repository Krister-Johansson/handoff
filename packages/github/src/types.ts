import type { PlanAncestor } from "./projects/types.ts";

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
  /** The pull request's description, as Markdown. */
  body: string;
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
  reviews: {
    id: string;
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | string;
    body: string;
    author: string;
    /** True for a GitHub App such as CodeRabbit, false for a person. */
    authorBot: boolean;
    commitSha: string | null;
    submittedAt: string | null;
  }[];
  reviewThreads: ReviewThread[];
  /** The last 50 issue comments, oldest first. `id` is GitHub's database id, the REST comment id. */
  comments: { id?: number; author: string; body: string; url: string; createdAt: string; updatedAt: string }[];
};

/** A comment in a review thread. `id` is GitHub's database id; `authorBot` is true for a GitHub App such as CodeRabbit. */
export type ReviewThreadComment = { id?: string; author: string; authorBot: boolean; body: string; path?: string; line?: number; url: string; createdAt: string };

/**
 * An inline review thread of a pull request. `id` is the GraphQL node id that replies and resolving take.
 * `line` is null once a push moved the code away (`isOutdated`); `originalLine` is where it was written.
 * `comments` holds the first comment only, `latest` the last ten, replies included.
 */
export type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  /** Whether the credential handoff runs with may reply in the thread, and resolve it. */
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  /** The login of whoever resolved the thread; null while it is open. */
  resolvedBy: string | null;
  comments: ReviewThreadComment[];
  latest: ReviewThreadComment[];
};

/** A review thread nobody resolved: where it is, whether a later push made it outdated, and its first comment. */
export type UnresolvedThread = { path: string; line: number | null; outdated: boolean; author: string; body: string; url: string };

/**
 * GitHub's merge state of a pull request (mergeStateStatus: BLOCKED, CLEAN, BEHIND, DIRTY, UNSTABLE and
 * so on) and its unresolved review threads, outdated or not.
 */
export type ReviewThreadState = { mergeState: string; threads: UnresolvedThread[] };

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

/** An open issue; `blockedBy` lists the open issues GitHub records as blocking it. */
export type IssueSummary = { number: number; title: string; url: string; labels: string[]; author: string | null; updatedAt: string; blockedBy: number[] };
export type IssueDetail = {
  number: number;
  title: string;
  url: string;
  body: string;
  state: "open" | "closed";
  /** Why a closed issue closed (completed, not_planned, duplicate); null while open or when GitHub does not say. */
  stateReason: string | null;
  labels: string[];
  assignees: Assignee[];
  /** Who opened it; null for a deleted account. */
  author: string | null;
  /** GitHub's author association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE and so on. */
  authorAssociation: string;
  createdAt: string;
  updatedAt: string;
  /** True when the number is a pull request's: GitHub's issues API answers for pull requests too. */
  pullRequest: boolean;
  /** The issue's own milestone, open or closed; null when it is in none. */
  milestone: MilestoneRef | null;
  /** The parent and the grandparent, nearest first; read only when `getIssue` is asked for them. */
  parents?: PlanAncestor[];
};

/** An issue another one refers to, open or closed. */
export type IssueRef = { number: number; title: string; url: string; state: "open" | "closed" };

/** GitHub's issue dependencies of one issue: the issues blocking it and the issues it blocks. */
export type IssueDependencies = { blockedBy: IssueRef[]; blocking: IssueRef[] };

/** A comment on an issue, with GitHub's author association (OWNER, MEMBER, CONTRIBUTOR, NONE and so on). */
export type IssueComment = { id: number; author: string | null; authorAssociation: string; createdAt: string; updatedAt: string; body: string; url: string };

/** A person assigned an issue: the login and the URL of their GitHub avatar image. */
export type Assignee = { login: string; avatarUrl: string };

/** A person who can be assigned issues in a repository. */
export type Assignable = Assignee;

/**
 * A milestone of a repository: a title and an optional due date over its issues and pull requests.
 * handoff reads milestones and sets an issue's milestone; it creates, edits and closes none.
 */
export type Milestone = {
  number: number;
  title: string;
  /** "" when the milestone has no description. */
  description: string;
  /** YYYY-MM-DD, the day of GitHub's due date; undefined without one. */
  dueOn: string | undefined;
  state: "open" | "closed";
  /** GitHub's counts of the open and closed issues in the milestone. */
  openIssues: number;
  closedIssues: number;
  url: string;
};

/** The milestone an issue is in, by number and title. */
export type MilestoneRef = Pick<Milestone, "number" | "title">;

export interface GitHubPort {
  /** Open issues of a repository (not pull requests), most recently updated first, up to 100. */
  listIssues(repo: RepoRef): Promise<IssueSummary[]>;
  /** An issue; with `parents`, also its parent chain from GitHub's sub-issues, which needs no Project access. */
  getIssue(repo: RepoRef, number: number, opts?: { parents?: boolean }): Promise<IssueDetail>;
  /** A file's text on a branch, or undefined when there is no such file. */
  getFile(repo: RepoRef, path: string, ref: string): Promise<string | undefined>;
  /** The open issues GitHub records as blocking this one (its "blocked by" dependencies). */
  openBlockers(repo: RepoRef, number: number): Promise<number[]>;
  /** Every issue blocking this one and every issue it blocks, open or closed, as GitHub records them. */
  dependencies(repo: RepoRef, number: number): Promise<IssueDependencies>;
  /** An issue's comments, oldest first as GitHub lists them. */
  listIssueComments(repo: RepoRef, number: number): Promise<IssueComment[]>;
  /** An issue's sub-issues in the order GitHub keeps them, open or closed. */
  listSubIssues(repo: RepoRef, number: number): Promise<IssueRef[]>;
  /** The people who can be assigned issues in the repository. */
  listAssignable(repo: RepoRef): Promise<Assignable[]>;
  /** Replaces an issue's assignees ([] clears them); returns the assignees GitHub kept, which drops logins it cannot assign. */
  setAssignees(repo: RepoRef, number: number, logins: string[]): Promise<Assignee[]>;
  /** Records on GitHub that `issue` is blocked by `blocker`. */
  addBlockedBy(repo: RepoRef, issue: number, blocker: number): Promise<void>;
  /** Comments on an issue, then closes it as completed. */
  closeIssue(repo: RepoRef, number: number, comment: string): Promise<void>;
  /** The repository's milestones, open and closed: those with a due date first, by due date, then the others, each run by number. */
  listMilestones(repo: RepoRef): Promise<Milestone[]>;
  /**
   * Sets an issue's milestone by the milestone's number, or clears it with null, through GraphQL updateIssue;
   * returns the milestone GitHub kept. Throws, writing nothing, for a milestone or an issue the repository lacks.
   */
  setMilestone(repo: RepoRef, issue: number, milestone: number | null): Promise<MilestoneRef | null>;
  /** Opens an issue with a title and a body, outside any plan. */
  createIssue(repo: RepoRef, input: { title: string; body: string }): Promise<{ number: number; url: string }>;
  /** The login of the token's user ("you" on the dashboard); undefined with a GitHub App, which acts as no person. */
  viewer(): Promise<string | undefined>;
  /** Repositories this credential can reach, most recently pushed first. */
  listRepos(): Promise<RepoSummary[]>;
  getRepoId(repo: RepoRef): Promise<number>;
  findPrByHead(repo: RepoRef, branch: string): Promise<PrInfo | undefined>;
  createPr(repo: RepoRef, input: { head: string; base: string; title: string; body: string }): Promise<PrInfo>;
  /** Replaces a pull request's title and description. */
  updatePr(repo: RepoRef, number: number, input: { title: string; body: string }): Promise<void>;
  getPrSnapshot(repo: RepoRef, number: number): Promise<PrSnapshot>;
  /** The pull request's merge state and its unresolved review threads (the first 100 threads), for a merge a ruleset blocks. */
  unresolvedReviewThreads(repo: RepoRef, number: number): Promise<ReviewThreadState>;
  /**
   * Replies in a review thread by its GraphQL node id (`ReviewThread.id`); returns the new comment's
   * database id, as `ReviewThreadComment.id` gives it, and its link. Throws when the thread is gone or the
   * credential may not reply (`viewerCanReply`).
   */
  replyToThread(repo: RepoRef, threadId: string, body: string): Promise<{ id: string; url: string }>;
  /**
   * Resolves a review thread by its GraphQL node id and reports whether GitHub now has it resolved.
   * Resolving a resolved thread is no error. Throws when the thread is gone or the credential may not
   * resolve it (`viewerCanResolve`).
   */
  resolveThread(repo: RepoRef, threadId: string): Promise<{ resolved: boolean }>;
  /** The paths of the files a pull request changes, as GitHub lists them (at most 3,000). */
  listPrFiles(repo: RepoRef, number: number): Promise<string[]>;
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
