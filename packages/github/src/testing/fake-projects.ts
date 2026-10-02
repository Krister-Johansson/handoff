import { kindOf, PLAN_KINDS, PLAN_SIZES, sizeOf, STATUS_OPTIONS, statusOf } from "../projects/kinds.ts";
import type {
  AdoptedProject,
  NewPlanIssue,
  PlanAncestor,
  PlanDateFieldIds,
  PlanDates,
  PlanEstimateFieldIds,
  PlanFields,
  PlanItem,
  PlanIteration,
  PlanProject,
  PlanProjectChoice,
  PlanStatus,
  ProjectsPort,
  SetDatesResult,
  SetFieldsResult,
  SetStatusResult,
} from "../projects/types.ts";
import type { RepoRef } from "../types.ts";
import { FakeGitHub } from "./fake-github.ts";

/** An item of a fake Project. `status` is the option's name, so a test can drag a card to a column handoff does not know. */
export type FakePlanItem = {
  status: string | undefined;
  prNumbers?: number[];
  assignees?: string[];
  /** YYYY-MM-DD, the item's Start and Target date field values. */
  start?: string | undefined;
  target?: string | undefined;
  iteration?: PlanIteration | undefined;
  /** The option name of the Priority field; listItems reads it only while the Project has `priorityOptions`. */
  priority?: string | undefined;
  /** The option name of the Size field, so a test can pick an option that is not S, M or L; read only while the Project has the field. */
  size?: string | undefined;
  /** Hours in the Estimate field; read only while the Project has the field, and 0 or less reads as none. */
  estimate?: number | undefined;
};

type FakePlan = { login: string; project: PlanProject; items: Map<number, FakePlanItem> };

const keyOf = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();

/**
 * In-memory GitHub Projects for tests: one Project per repository. Issue titles, bodies, labels, state and
 * blockers live in the FakeGitHub it is given, so closing an issue there shows as closed in the plan.
 * Tests change `itemsOf(repo)` directly to simulate a person moving a card on GitHub's board. Project order
 * is the order items joined `itemsOf(repo)`.
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
    return [...plan.items].flatMap(([issueNumber, item], index) => {
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
          blockers: [...(issue.blockedBy ?? [])],
          position: index + 1,
          priority: plan.project.priorityOptions ? item.priority : undefined,
          prNumbers: item.prNumbers ?? [],
          updatedAt: issue.updatedAt ?? "",
          start: item.start,
          target: item.target,
          iteration: item.iteration,
          size: plan.project.estimateFields?.size ? sizeOf(item.size) : undefined,
          estimate: plan.project.estimateFields?.estimate && item.estimate !== undefined && item.estimate > 0 ? item.estimate : undefined,
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

  async listProjects(login: string, repo: RepoRef): Promise<PlanProjectChoice[]> {
    const choices = [...this.plans].filter(([, plan]) => plan.login === login).map(([key, plan]) => ({
      number: plan.project.number,
      title: plan.project.title,
      url: plan.project.url,
      linked: key === keyOf(repo),
      missingStatusOptions: STATUS_OPTIONS.filter((s) => !plan.project.statusOptions[s]),
    }));
    return [...choices.filter((c) => c.linked), ...choices.filter((c) => !c.linked)];
  }

  /** Links the Project to `repo` (it becomes that repository's Project here) and adds the Status options it lacks. */
  async adoptProject(login: string, number: number, repo: RepoRef): Promise<AdoptedProject> {
    const entry = [...this.plans].find(([, p]) => p.login === login && p.project.number === number);
    if (!entry) throw new Error(`GitHub Project #${number} of ${login} not found`);
    const [key, plan] = entry;
    const added = STATUS_OPTIONS.filter((s) => !plan.project.statusOptions[s]);
    for (const status of added) plan.project.statusOptions[status] = `opt-${status.toLowerCase().replace(" ", "-")}`;
    this.plans.delete(key);
    this.plans.set(keyOf(repo), plan);
    return { project: structuredClone(plan.project), renamed: [], added };
  }

  async createProject(login: string, repo: RepoRef, title: string): Promise<PlanProject> {
    const number = this.nextProject++;
    const project: PlanProject = {
      number,
      url: `https://github.com/users/${login}/projects/${number}`,
      title,
      statusOptions: { Shaping: "opt-shaping", Ready: "opt-ready", Running: "opt-running", "In review": "opt-in-review", Done: "opt-done" },
      dateFields: { start: "field-start", target: "field-target" },
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
    input: NewPlanIssue,
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
    if (input.start || input.target) {
      const result = await this.setDates(repo, input.project, number, { ...(input.start ? { start: input.start } : {}), ...(input.target ? { target: input.target } : {}) });
      if (result !== "set") throw new Error(`Created #${number}, but could not set its dates: ${result}`);
    }
    return { number, url };
  }

  async addIssue(repo: RepoRef, input: { project: number; issue: number; labels: string[]; parent?: number }): Promise<void> {
    const issue = this.github.issues.get(input.issue);
    if (!issue) throw new Error(`issue #${input.issue} not found`);
    if (input.parent !== undefined && !this.github.issues.has(input.parent)) throw new Error(`parent issue #${input.parent} not found`);
    issue.labels = [...new Set([...(issue.labels ?? []), ...input.labels])];
    if (input.parent !== undefined) this.parents.set(input.issue, input.parent);
    await this.setStatus(repo, input.project, input.issue, "Shaping", { add: true });
  }

  async setDates(repo: RepoRef, project: number, issue: number, dates: PlanDates): Promise<SetDatesResult> {
    const result = await this.setPlanFields(repo, project, issue, dates);
    if (result === "no-option") throw new Error(`setDates got no-option for #${issue}`);
    return result;
  }

  async setPlanFields(repo: RepoRef, project: number, issue: number, fields: PlanFields): Promise<SetFieldsResult> {
    const plan = this.planOf(repo, project);
    const item = plan?.items.get(issue);
    if (!plan || !item) return "not-in-project";
    const { dateFields, estimateFields } = plan.project;
    const has = { start: dateFields?.start, target: dateFields?.target, size: estimateFields?.size, estimate: estimateFields?.estimate };
    if ((Object.keys(has) as (keyof typeof has)[]).some((key) => fields[key] !== undefined && !has[key])) return "no-field";
    if (fields.size && !estimateFields?.size?.options[fields.size]) return "no-option";
    if (fields.start !== undefined) item.start = fields.start ?? undefined;
    if (fields.target !== undefined) item.target = fields.target ?? undefined;
    if (fields.size !== undefined) item.size = fields.size ?? undefined;
    if (fields.estimate !== undefined) item.estimate = fields.estimate ?? undefined;
    return "set";
  }

  async ensureEstimateFields(login: string, number: number): Promise<PlanEstimateFieldIds> {
    const plan = [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
    if (!plan) throw new Error(`GitHub Project #${number} of ${login} not found`);
    const current = plan.project.estimateFields;
    const options = current?.size?.options;
    const fields: PlanEstimateFieldIds = {
      size: {
        id: current?.size?.id ?? "field-size",
        options: Object.fromEntries(PLAN_SIZES.map((s) => [s, options?.[s] ?? `opt-size-${s.toLowerCase()}`])) as NonNullable<PlanEstimateFieldIds["size"]>["options"],
      },
      estimate: current?.estimate ?? "field-estimate",
    };
    plan.project.estimateFields = fields;
    return structuredClone(fields);
  }

  async ensureDateFields(login: string, number: number): Promise<PlanDateFieldIds> {
    const plan = [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
    if (!plan) throw new Error(`GitHub Project #${number} of ${login} not found`);
    const fields = { start: plan.project.dateFields?.start ?? "field-start", target: plan.project.dateFields?.target ?? "field-target" };
    plan.project.dateFields = fields;
    return { ...fields };
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
