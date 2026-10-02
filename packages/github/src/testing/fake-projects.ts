import { kindOf, PLAN_KINDS, statusOf } from "../projects/kinds.ts";
import type { PlanAncestor, PlanItem, PlanProject, PlanStatus, ProjectsPort, SetStatusResult } from "../projects/types.ts";
import type { RepoRef } from "../types.ts";
import { FakeGitHub } from "./fake-github.ts";

/** An item of a fake Project. `status` is the option's name, so a test can drag a card to a column handoff does not know. */
export type FakePlanItem = { status: string | undefined; prNumbers?: number[]; assignees?: string[] };

type FakePlan = { login: string; project: PlanProject; items: Map<number, FakePlanItem> };

const keyOf = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();

/**
 * In-memory GitHub Projects for tests: one Project per repository. Issue titles, bodies, labels, state and
 * blockers live in the FakeGitHub it is given, so closing an issue there shows as closed in the plan.
 * Tests change `itemsOf(repo)` directly to simulate a person moving a card on GitHub's board.
 */
export class FakeProjects implements ProjectsPort {
  readonly plans = new Map<string, FakePlan>();
  /** Labels created on each repository, by repository key. */
  readonly labels = new Map<string, Set<string>>();
  scopesAnswer = { project: true, classic: true };
  private nextProject = 1;

  constructor(readonly github: FakeGitHub = new FakeGitHub()) {}

  /** Parent issue number by issue number: GitHub's sub-issue relation, kept in the FakeGitHub. */
  get parents(): Map<number, number> {
    return this.github.parents;
  }

  /** The items of the repository's Project; throws when it has none. */
  itemsOf(repo: RepoRef): Map<number, FakePlanItem> {
    const plan = this.plans.get(keyOf(repo));
    if (!plan) throw new Error(`no Project for ${keyOf(repo)}`);
    return plan.items;
  }

  async getProject(login: string, number: number): Promise<PlanProject | undefined> {
    const plan = [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
    return plan ? structuredClone(plan.project) : undefined;
  }

  async listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]> {
    const plan = this.planOf(repo, number);
    if (!plan || plan.login !== login) return [];
    return [...plan.items].flatMap(([issueNumber, item]) => {
      const issue = this.github.issues.get(issueNumber);
      if (!issue) return [];
      const labels = issue.labels ?? [];
      const children = [...this.parents].filter(([, parent]) => parent === issueNumber).map(([child]) => this.github.issues.get(child));
      return [
        {
          number: issue.number,
          title: issue.title,
          url: issue.url,
          state: issue.state,
          kind: kindOf(labels, undefined, this.depthOf(issueNumber)),
          status: statusOf(item.status),
          parent: this.parents.get(issueNumber),
          labels,
          assignees: item.assignees ?? [],
          subIssues: { total: children.length, completed: children.filter((c) => c?.state === "closed").length },
          blockedBy: (issue.blockedBy ?? []).filter((n) => this.github.issues.get(n)?.state !== "closed"),
          prNumbers: item.prNumbers ?? [],
          updatedAt: issue.updatedAt ?? "",
        },
      ];
    });
  }

  async getStatus(repo: RepoRef, project: number, issue: number): Promise<PlanStatus | undefined> {
    return statusOf(this.planOf(repo, project)?.items.get(issue)?.status);
  }

  async setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts: { add?: boolean } = {}): Promise<SetStatusResult> {
    const plan = this.planOf(repo, project);
    if (!plan) return "not-in-project";
    let item = plan.items.get(issue);
    if (!item && opts.add && this.github.issues.has(issue)) {
      item = { status: undefined };
      plan.items.set(issue, item);
    }
    if (!item) return "not-in-project";
    if (!plan.project.statusOptions[status]) return "no-option";
    item.status = status;
    return "set";
  }

  async createProject(login: string, repo: RepoRef, title: string): Promise<PlanProject> {
    const number = this.nextProject++;
    const project: PlanProject = {
      number,
      url: `https://github.com/users/${login}/projects/${number}`,
      title,
      statusOptions: { Shaping: "opt-shaping", Ready: "opt-ready", Running: "opt-running", "In review": "opt-in-review", Done: "opt-done" },
    };
    this.plans.set(keyOf(repo), { login, project, items: new Map() });
    return structuredClone(project);
  }

  async ensureLabels(repo: RepoRef): Promise<void> {
    const labels = this.labels.get(keyOf(repo)) ?? new Set<string>();
    for (const kind of PLAN_KINDS) labels.add(kind);
    this.labels.set(keyOf(repo), labels);
  }

  async createIssue(
    repo: RepoRef,
    input: { project: number; title: string; body: string; labels: string[]; parent?: number; blockedBy?: number[] },
  ): Promise<{ number: number; url: string }> {
    if (input.parent !== undefined && !this.github.issues.has(input.parent)) throw new Error(`parent issue #${input.parent} not found`);
    const number = Math.max(0, ...this.github.issues.keys()) + 1;
    const url = `https://github.com/${repo.owner}/${repo.name}/issues/${number}`;
    this.github.issues.set(number, {
      number,
      title: input.title,
      url,
      body: input.body,
      state: "open",
      labels: [...input.labels],
      blockedBy: [...(input.blockedBy ?? [])],
      updatedAt: new Date().toISOString(),
    });
    if (input.parent !== undefined) this.parents.set(number, input.parent);
    await this.setStatus(repo, input.project, number, "Shaping", { add: true });
    return { number, url };
  }

  async lineage(_repo: RepoRef, issue: number): Promise<PlanAncestor[]> {
    return this.github.ancestorsOf(issue);
  }

  async scopes() {
    return { ...this.scopesAnswer };
  }

  private planOf(repo: RepoRef, number: number): FakePlan | undefined {
    const plan = this.plans.get(keyOf(repo));
    return plan?.project.number === number ? plan : undefined;
  }

  private depthOf(issue: number): number {
    return this.github.depthOf(issue);
  }
}
