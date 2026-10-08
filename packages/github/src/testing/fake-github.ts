import { execFileSync } from "node:child_process";
import { kindOf } from "../projects/kinds.ts";
import type { PlanAncestor } from "../projects/types.ts";
import { GitHubReadError } from "../errors.ts";
import type {
  Assignable,
  Assignee,
  GitHubPort,
  IssueComment,
  IssueDependencies,
  IssueDetail,
  IssueRef,
  IssueSummary,
  Milestone,
  MilestoneRef,
  PrInfo,
  PrSnapshot,
  RepoRef,
  RepoSummary,
  ReviewThread,
  ReviewThreadComment,
  ReviewThreadState,
} from "../types.ts";

/** A comment in a review thread of the fake; the snapshot fills in the author's type and the time a test left out. */
export type FakeThreadComment = Omit<ReviewThreadComment, "authorBot" | "createdAt"> & Partial<Pick<ReviewThreadComment, "authorBot" | "createdAt">>;

/**
 * A review thread of the fake with every comment in it, oldest first. A test may leave out what GitHub always
 * has: the snapshot gives the thread an id and takes its place and the viewer's rights from GitHub's defaults.
 */
export type FakeThread = Partial<Omit<ReviewThread, "comments" | "latest">> & { isResolved: boolean; comments: FakeThreadComment[] };

/** A pull request of the fake; `mergeState` is GitHub's mergeStateStatus when a test sets one, CLEAN otherwise. */
type FakePr = Omit<PrSnapshot, "reviewThreads"> & { reviewThreads: FakeThread[]; base: string; files?: string[]; mergeState?: string };

/** The login a GitHub App's installation writes as in the fake. */
const APP_LOGIN = "handoff[bot]";

/**
 * An issue of the fake: what every issue has, and any of GitHub's other facts a test wants to set.
 * Assignees are logins; the reads give each one an avatar. `milestone` is a milestone's number.
 */
export type FakeIssue = Pick<IssueDetail, "number" | "title" | "url" | "body" | "state"> &
  Partial<Omit<IssueDetail, "number" | "title" | "url" | "body" | "state" | "parents" | "assignees" | "milestone">> &
  Partial<Pick<IssueSummary, "blockedBy">> & { assignees?: string[]; milestone?: number | undefined };

/** A milestone of the fake: its number and title, and any other fact a test sets. The counts come from the fake's issues. */
export type FakeMilestone = MilestoneRef & Partial<Pick<Milestone, "description" | "dueOn" | "state" | "url">>;

/** An issue as getIssue gives it, with GitHub's defaults for the facts a test left out. */
function detailOf(issue: FakeIssue, person: (login: string) => Assignee, milestone: MilestoneRef | undefined): IssueDetail {
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
    milestone: milestone ?? null,
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
  /** The repository's milestones by number; an issue is in one through its `milestone`. */
  readonly milestones = new Map<number, FakeMilestone>();
  /** Every setMilestone write, with the milestone number it set or null for a clear. */
  readonly milestoneWrites: { number: number; milestone: number | null }[] = [];
  /** Logins of GitHub Apps; a login ending in [bot] is one too. */
  readonly bots = new Set<string>(["coderabbitai"]);
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

  async removeBlockedBy(_repo: RepoRef, issue: number, blocker: number) {
    const found = this.issues.get(issue);
    if (!found) throw new Error(`no issue ${issue}`);
    found.blockedBy = (found.blockedBy ?? []).filter((n) => n !== blocker);
  }

  async getIssue(_repo: RepoRef, number: number, opts: { parents?: boolean } = {}): Promise<IssueDetail> {
    if (this.unreachable) throw new GitHubReadError("unreachable", `GitHub did not answer for #${number}.`);
    const issue = this.issues.get(number);
    const pr = issue ? undefined : this.prs.get(number);
    if (pr) return { ...detailOf({ number, title: pr.title, url: pr.url, body: pr.body, state: pr.state === "open" ? "open" : "closed", updatedAt: pr.updatedAt }, (login) => this.person(login), undefined), pullRequest: true };
    if (!issue) throw new GitHubReadError("not-found", `no issue ${number}`);
    return { ...detailOf(issue, (login) => this.person(login), this.milestoneOf(number)), ...(opts.parents ? { parents: this.ancestorsOf(number) } : {}) };
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

  /** Adds a comment to an issue, as a person would on GitHub; returns its id. */
  comment(number: number, author: string, body: string, opts: { at?: string; association?: string } = {}) {
    const id = this.nextComment++;
    const at = opts.at ?? new Date().toISOString();
    const url = `${this.issues.get(number)?.url ?? `https://github.com/octo/sample/issues/${number}`}#issuecomment-${id}`;
    this.comments.set(number, [...(this.comments.get(number) ?? []), { id, author, authorAssociation: opts.association ?? "NONE", createdAt: at, updatedAt: at, body, url }]);
    return id;
  }

  /**
   * Creates a bot's summary comment on a pull request, or edits the one it has whose first line is the same,
   * the way CodeRabbit keeps one summary per pull request. It shows in the snapshot and in listIssueComments.
   * Returns the comment's id, which an edit keeps.
   */
  summaryComment(number: number, body: string, opts: { author?: string; at?: string } = {}) {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    const author = opts.author ?? "coderabbitai";
    const at = opts.at ?? new Date().toISOString();
    const firstLine = (text: string) => text.split("\n", 1)[0];
    const existing = pr.comments.find((c) => c.author === author && firstLine(c.body) === firstLine(body));
    if (existing?.id !== undefined) {
      Object.assign(existing, { body, updatedAt: at });
      const listed = this.comments.get(number)?.find((c) => c.id === existing.id);
      if (listed) Object.assign(listed, { body, updatedAt: at });
      return existing.id;
    }
    const id = this.comment(number, author, body, { at });
    pr.comments.push({ id, author, body, url: `${pr.url}#issuecomment-${id}`, createdAt: at, updatedAt: at });
    return id;
  }

  /** Whether a login is a GitHub App's, as GitHub's author type tells. */
  isBot(login: string) {
    return this.bots.has(login) || login.endsWith("[bot]");
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

  /** Dated milestones by due date first, then the others, each run by number, as OctokitGitHub orders them. */
  async listMilestones(repo: RepoRef): Promise<Milestone[]> {
    const issues = [...this.issues.values()];
    const count = (number: number, state: "open" | "closed") => issues.filter((i) => i.milestone === number && i.state === state).length;
    return [...this.milestones.values()]
      .map((m) => ({
        number: m.number,
        title: m.title,
        description: m.description ?? "",
        dueOn: m.dueOn,
        state: m.state ?? "open",
        openIssues: count(m.number, "open"),
        closedIssues: count(m.number, "closed"),
        url: m.url ?? `https://github.com/${repo.owner}/${repo.name}/milestone/${m.number}`,
      }))
      .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number - b.number);
  }

  async setMilestone(repo: RepoRef, number: number, milestone: number | null): Promise<MilestoneRef | null> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`issue ${repo.owner}/${repo.name}#${number} not found`);
    const found = milestone === null ? undefined : this.milestones.get(milestone);
    if (milestone !== null && !found) throw new Error(`${repo.owner}/${repo.name} has no milestone #${milestone}`);
    issue.milestone = found?.number;
    this.milestoneWrites.push({ number, milestone });
    return found ? { number: found.number, title: found.title } : null;
  }

  /** The milestone an issue is in, by number and title; undefined for none or one the fake does not have. */
  milestoneOf(number: number): MilestoneRef | undefined {
    const found = this.milestones.get(this.issues.get(number)?.milestone ?? Number.NaN);
    return found ? { number: found.number, title: found.title } : undefined;
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
    const { reviewThreads, base: _base, files: _files, mergeState: _mergeState, ...rest } = structuredClone(pr);
    return { ...rest, reviewThreads: reviewThreads.map((t, i) => this.threadOf(number, i, t)) };
  }

  /** A thread of the fake as GitHub's snapshot gives it: its first comment and its last ten, with GitHub's defaults. */
  private threadOf(number: number, index: number, t: FakeThread): ReviewThread {
    const comment = (c: FakeThreadComment): ReviewThreadComment => ({ ...c, authorBot: c.authorBot ?? this.isBot(c.author), createdAt: c.createdAt ?? "" });
    const first = t.comments[0];
    return {
      id: this.threadId(number, index),
      isResolved: t.isResolved,
      isOutdated: t.isOutdated ?? false,
      path: t.path ?? first?.path ?? "",
      line: t.line !== undefined ? t.line : (first?.line ?? null),
      originalLine: t.originalLine !== undefined ? t.originalLine : (first?.line ?? null),
      viewerCanReply: t.viewerCanReply ?? true,
      viewerCanResolve: t.viewerCanResolve ?? true,
      resolvedBy: t.resolvedBy ?? null,
      comments: t.comments.slice(0, 1).map(comment),
      latest: t.comments.slice(-10).map(comment),
    };
  }

  private nextThread = 1;

  /** A thread's GraphQL node id; a thread a test pushed without one gets one the first time it is read. */
  private threadId(number: number, index: number): string {
    const thread = this.prs.get(number)!.reviewThreads[index]!;
    thread.id ??= `PRRT_fake${this.nextThread++}`;
    return thread.id;
  }

  /** The pull request and the thread with a GraphQL node id, or GitHub's NOT_FOUND error. */
  private findThread(threadId: string): { pr: FakePr; thread: FakeThread } {
    for (const pr of this.prs.values()) {
      pr.reviewThreads.forEach((_, i) => this.threadId(pr.number, i));
      const thread = pr.reviewThreads.find((t) => t.id === threadId);
      if (thread) return { pr, thread };
    }
    throw new Error(`Could not resolve to a node with the global id of '${threadId}'`);
  }

  /** The login the credential writes as: the token's user, or the App's bot. */
  private get writer() {
    return this.login ?? APP_LOGIN;
  }

  async replyToThread(_repo: RepoRef, threadId: string, body: string): Promise<{ id: string; url: string }> {
    const { pr, thread } = this.findThread(threadId);
    if (thread.viewerCanReply === false) throw new Error(`${this.writer} may not reply in review thread ${threadId}`);
    return this.addThreadComment(pr, thread, this.writer, body);
  }

  async resolveThread(_repo: RepoRef, threadId: string): Promise<{ resolved: boolean }> {
    const { thread } = this.findThread(threadId);
    if (thread.isResolved) return { resolved: true };
    if (thread.viewerCanResolve === false) throw new Error(`${this.writer} may not resolve review thread ${threadId}`);
    thread.isResolved = true;
    thread.resolvedBy = this.writer;
    return { resolved: true };
  }

  private addThreadComment(pr: FakePr, thread: FakeThread, author: string, body: string) {
    const id = String(this.nextComment++);
    const url = `${pr.url}#discussion_r${id}`;
    const first = thread.comments[0];
    thread.comments.push({ id, author, body, ...(first?.path ? { path: first.path } : {}), ...(first?.line ? { line: first.line } : {}), url, createdAt: new Date().toISOString() });
    return { id, url };
  }

  /** The thread with this id on pull request `number`; a test helper's guard against a wrong number. */
  private threadOn(number: number, threadId: string) {
    const found = this.findThread(threadId);
    if (found.pr.number !== number) throw new Error(`thread ${threadId} is not on PR ${number}`);
    return found;
  }

  /** Someone other than handoff replies in a thread, as the reviewer or a person does on GitHub. */
  replyInThread(number: number, threadId: string, author: string, body: string) {
    const { pr, thread } = this.threadOn(number, threadId);
    return this.addThreadComment(pr, thread, author, body);
  }

  /** Someone resolves one thread on GitHub, such as the reviewer after a fix. */
  resolveThreadAs(number: number, threadId: string, login: string) {
    const { thread } = this.threadOn(number, threadId);
    thread.isResolved = true;
    thread.resolvedBy = login;
  }

  /** A thread disappears from the pull request, as when its comments are deleted. */
  deleteThread(number: number, threadId: string) {
    const { pr } = this.threadOn(number, threadId);
    pr.reviewThreads = pr.reviewThreads.filter((t) => t.id !== threadId);
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

  /** The base branch's ruleset requires every review conversation to be resolved before a merge. */
  requireResolvedThreads = false;

  /** GitHub's merge state: BLOCKED while the ruleset waits on an unresolved thread, else what the test set, else CLEAN. */
  private mergeStateOf(pr: FakePr) {
    if (this.requireResolvedThreads && pr.reviewThreads.some((t) => !t.isResolved)) return "BLOCKED";
    return pr.mergeState ?? "CLEAN";
  }

  async unresolvedReviewThreads(_repo: RepoRef, number: number): Promise<ReviewThreadState> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    const threads = pr.reviewThreads
      .filter((t) => !t.isResolved)
      .map((t) => {
        const first = t.comments[0];
        return {
          path: t.path ?? first?.path ?? "",
          line: t.line !== undefined ? t.line : (first?.line ?? null),
          outdated: t.isOutdated ?? false,
          author: first?.author ?? "ghost",
          body: first?.body ?? "",
          url: first?.url ?? "",
        };
      });
    return { mergeState: this.mergeStateOf(pr), threads };
  }

  /** Resolves every open review thread of the pull request, as a person does on GitHub. */
  resolveThreads(number: number, by = "octocat") {
    for (const thread of this.prs.get(number)!.reviewThreads) {
      if (thread.isResolved) continue;
      thread.isResolved = true;
      thread.resolvedBy = by;
    }
  }

  async mergePr(_repo: RepoRef, number: number) {
    const pr = this.prs.get(number);
    if (!pr || pr.state !== "open" || pr.mergeable === "CONFLICTING") return { merged: false };
    // GitHub answers 405 when a ruleset blocks the merge.
    if (this.mergeStateOf(pr) === "BLOCKED") throw new Error(`Repository rule violations found. PR #${number} is blocked by the base branch's rules.`);
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
    const at = new Date().toISOString();
    const existing = pr.comments.find((c) => c.body.includes(marker));
    if (existing) {
      Object.assign(existing, { body, updatedAt: at });
      return { id: existing.id ?? 0, created: false };
    }
    const id = this.nextComment++;
    pr.comments.push({ id, author: "handoff", body, url: `${pr.url}#issuecomment-${id}`, createdAt: at, updatedAt: at });
    return { id, created: true };
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
    const at = new Date().toISOString();
    pr.reviews.push({ id, state: review.state ?? "COMMENTED", body: review.body ?? "", author, authorBot: this.isBot(author), commitSha: pr.headSha, submittedAt: at });
    pr.reviewThreads.push(
      ...(review.threads ?? []).map((t, i) => ({
        isResolved: false,
        comments: [{ id: `${id}-${i}`, author, body: t.body, path: t.path, ...(t.line ? { line: t.line } : {}), url: `https://review/${number}#${id}-${i}`, createdAt: at }],
      })),
    );
    return id;
  }

  review(number: number, decision: "APPROVED" | "CHANGES_REQUESTED", comments: { author: string; body: string; path?: string; line?: number }[] = []) {
    const pr = this.prs.get(number)!;
    pr.reviewDecision = decision;
    pr.reviewThreads.push(...comments.map((c) => ({ isResolved: false, comments: [{ ...c, url: `https://review/${number}` }] })));
  }
}
