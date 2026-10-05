import { kindOf, PLAN_KINDS, PLAN_SIZES, sizeOf, STATUS_OPTIONS, statusOf } from "../projects/kinds.ts";
import type {
  AdoptedProject,
  CopyField,
  ItemMove,
  NewPlanIssue,
  PlanAncestor,
  PlanDateFieldIds,
  PlanDates,
  PlanEstimateFieldIds,
  PlanFields,
  PlanFieldsChange,
  PlanItem,
  PlanIteration,
  PlanProject,
  PlanProjectChoice,
  PlanStatus,
  ProjectRef,
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
  /**
   * The option name of the Project's own Priority field; listItems reads it only while the Project has
   * `priorityOptions`. Without them it reads the issue's value in `issuePriorities` for an organization with a
   * Priority issue field.
   */
  priority?: string | undefined;
  /** The option name of the Size field, so a test can pick an option that is not S, M or L; read only while the Project has the field. */
  size?: string | undefined;
  /** Hours in the Estimate field; read only while the Project has the field, and 0 or less reads as none. */
  estimate?: number | undefined;
};

type FakePlan = { login: string; project: PlanProject; items: Map<number, FakePlanItem> };
type OwnerType = NonNullable<PlanProject["owner"]>;

/** A fake item's node id, from its issue number, and back. */
const itemIdOf = (issue: number) => `PVTI_${issue}`;
const issueOf = (itemId: string) => Number(itemId.slice("PVTI_".length));

const keyOf = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();

/** The name on GitHub of each field copyItems copies. */
const COPY_FIELD_NAMES: Record<CopyField, string> = { start: "Start", target: "Target", size: "Size", estimate: "Estimate" };

/** Why `fields` cannot be written on the issue's item of the plan, as setPlanFields answers; undefined when they can. */
function fieldsProblem(plan: FakePlan | undefined, issue: number, fields: PlanFields): Exclude<SetFieldsResult, "set"> | undefined {
  if (!plan?.items.has(issue)) return "not-in-project";
  const { dateFields, estimateFields } = plan.project;
  const has = { start: dateFields?.start, target: dateFields?.target, size: estimateFields?.size, estimate: estimateFields?.estimate };
  if ((Object.keys(has) as (keyof typeof has)[]).some((key) => fields[key] !== undefined && !has[key])) return "no-field";
  if (fields.size && !estimateFields?.size?.options[fields.size]) return "no-option";
  return undefined;
}

/**
 * In-memory GitHub Projects for tests: one Project per repository, owned by the login it was created for,
 * a user unless `owners` names it an organization. Issue titles, bodies, labels, state and
 * blockers live in the FakeGitHub it is given, so closing an issue there shows as closed in the plan.
 * Tests change `itemsOf(repo)` directly to simulate a person moving a card on GitHub's board. Project order
 * is the order of `itemsOf(repo)`: the order items joined, until moveItems reorders them. An item's id is
 * `PVTI_<issue>`.
 */
export class FakeProjects implements ProjectsPort {
  readonly plans = new Map<string, FakePlan>();
  /** Labels created on each repository, by repository key. */
  readonly labels = new Map<string, Set<string>>();
  /** The type of each repository owner by login; a login not in it is a user. */
  readonly owners = new Map<string, OwnerType>();
  /** Whether the token's user can create Projects for an owner, by login; a login not in it can. */
  readonly canCreateProjects = new Map<string, boolean>();
  /** GitHub's issue type of an issue by number, such as an organization's Task, Bug or Feature; an issue not in it has none. */
  readonly issueTypes = new Map<number, string>();
  /**
   * The options of an organization's Priority issue field by login, the highest first; an owner not in it has
   * none. It gives Priority to a Project of the organization without a Priority field of its own.
   */
  readonly priorityIssueFields = new Map<string, string[]>();
  /** An issue's value of its organization's Priority issue field, by issue number. */
  readonly issuePriorities = new Map<number, string>();
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
    return plan ? { ...structuredClone(plan.project), ...this.priorityOf(plan) } : undefined;
  }

  /** The organization's Priority issue field options for a plan whose owner is an organization; undefined otherwise. */
  private issueFieldOf(plan: FakePlan): string[] | undefined {
    return this.owners.get(plan.login) === "Organization" ? this.priorityIssueFields.get(plan.login) : undefined;
  }

  /** The Project's own Priority field (`priorityOptions` set on the Project) wins over the organization's issue field, as on GitHub. */
  private priorityOf(plan: FakePlan): Pick<PlanProject, "priorityOptions" | "prioritySource"> {
    if (plan.project.priorityOptions) return { priorityOptions: plan.project.priorityOptions, prioritySource: "project" };
    const issueField = this.issueFieldOf(plan);
    return issueField ? { priorityOptions: [...issueField], prioritySource: "issue-field" } : { priorityOptions: undefined, prioritySource: undefined };
  }

  async listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]> {
    const plan = this.planOf(repo, number);
    if (!plan || plan.login !== login) return [];
    const priorityOf = (issue: number, item: FakePlanItem) => (plan.project.priorityOptions ? item.priority : this.issueFieldOf(plan) ? this.issuePriorities.get(issue) : undefined);
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
          kind: kindOf(labels, this.issueTypes.get(issueNumber), this.depthOf(issueNumber)),
          status: statusOf(item.status),
          parent: this.parents.get(issueNumber),
          labels,
          assignees: (issue.assignees ?? item.assignees ?? []).map((login) => this.github.person(login)),
          subIssues: { total: children.length, completed: children.filter((c) => c?.state === "closed").length },
          blockedBy: (issue.blockedBy ?? []).filter((n) => this.github.issues.get(n)?.state !== "closed"),
          blockers: [...(issue.blockedBy ?? [])],
          position: index + 1,
          itemId: itemIdOf(issueNumber),
          priority: priorityOf(issueNumber, item),
          prNumbers: item.prNumbers ?? [],
          updatedAt: issue.updatedAt ?? "",
          milestone: this.github.milestoneOf(issueNumber),
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

  /** Creates the Project under `login`, a user or an organization as `owners` says; refuses before creating anything when `canCreateProjects` says no. */
  async createProject(login: string, repo: RepoRef, title: string, opts: { dateFields?: boolean } = {}): Promise<PlanProject> {
    const owner = this.owners.get(login) ?? "User";
    if (this.canCreateProjects.get(login) === false) {
      throw new Error(
        owner === "Organization"
          ? `Your GitHub account cannot create Projects in ${login}. An organization owner can let members create Projects, or create one and run setup_plan with use.`
          : `Your GitHub account cannot create Projects for ${login}. Create one as ${login}, then run setup_plan with use.`,
      );
    }
    const number = this.nextProject++;
    const project: PlanProject = {
      number,
      url: `https://github.com/${owner === "Organization" ? "orgs" : "users"}/${login}/projects/${number}`,
      title,
      owner,
      statusOptions: { Shaping: "opt-shaping", Ready: "opt-ready", Running: "opt-running", "In review": "opt-in-review", Done: "opt-done" },
      dateFields: opts.dateFields === false ? { start: undefined, target: undefined } : { start: "field-start", target: "field-target" },
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
    if (input.milestone !== undefined && !this.github.milestones.has(input.milestone)) throw new Error(`${repo.owner}/${repo.name} has no milestone #${input.milestone}`);
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
      milestone: input.milestone,
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
    const problem = fieldsProblem(plan, issue, fields);
    if (problem) return problem;
    const item = plan!.items.get(issue)!;
    if (fields.start !== undefined) item.start = fields.start ?? undefined;
    if (fields.target !== undefined) item.target = fields.target ?? undefined;
    if (fields.size !== undefined) item.size = fields.size ?? undefined;
    if (fields.estimate !== undefined) item.estimate = fields.estimate ?? undefined;
    return "set";
  }

  async setManyPlanFields(repo: RepoRef, project: number, changes: PlanFieldsChange[]): Promise<{ issue: number; result: SetFieldsResult }[]> {
    const plan = this.planOf(repo, project);
    const checked = changes.map(({ issue, fields }) => ({ issue, result: fieldsProblem(plan, issue, fields) ?? ("set" as const) }));
    const refused = checked.filter((c) => c.result !== "set");
    if (refused.length) return refused;
    for (const { issue, fields } of changes) await this.setPlanFields(repo, project, issue, fields);
    return checked;
  }

  async ensureEstimateFields(login: string, number: number, opts: { estimate?: boolean } = {}): Promise<PlanEstimateFieldIds> {
    const plan = [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
    if (!plan) throw new Error(`GitHub Project #${number} of ${login} not found`);
    const current = plan.project.estimateFields;
    const options = current?.size?.options;
    const fields: PlanEstimateFieldIds = {
      size: {
        id: current?.size?.id ?? "field-size",
        options: Object.fromEntries(PLAN_SIZES.map((s) => [s, options?.[s] ?? `opt-size-${s.toLowerCase()}`])) as NonNullable<PlanEstimateFieldIds["size"]>["options"],
      },
      estimate: current?.estimate ?? (opts.estimate === false ? undefined : "field-estimate"),
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

  /** Applies the moves one after another, as GitHub does; an unknown item throws after the moves before it. */
  async moveItems(login: string, number: number, moves: ItemMove[]): Promise<void> {
    const plan = [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
    if (!plan) throw new Error(`GitHub Project #${number} of ${login} not found`);
    const order = [...plan.items.keys()].map(itemIdOf);
    // Refills the same Map, so a test holding `itemsOf(repo)` sees the new order.
    const place = () => {
      const entries = order.map((id) => [issueOf(id), plan.items.get(issueOf(id))!] as const);
      plan.items.clear();
      for (const [issue, item] of entries) plan.items.set(issue, item);
    };
    for (const [index, { itemId, afterId }] of moves.entries()) {
      if (!order.includes(itemId) || (afterId !== null && !order.includes(afterId))) {
        place();
        throw new Error(`GitHub moved ${index} of ${moves.length} items in Project order, then refused: no item ${afterId !== null && order.includes(itemId) ? afterId : itemId}`);
      }
      order.splice(order.indexOf(itemId), 1);
      order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, itemId);
    }
    place();
  }

  /**
   * Copies the items of `from` into `to` with their Status and the given fields, in `from`'s order within the places
   * the copied items take in `to`. Every issue of the FakeGitHub belongs to `repo`. Throws when `to` lacks a field.
   */
  async copyItems(_repo: RepoRef, from: ProjectRef, to: ProjectRef, fields: CopyField[]): Promise<{ copied: number[]; priorities: number[] }> {
    const source = this.projectOf(from);
    const target = this.projectOf(to);
    if (!source) throw new Error(`GitHub Project #${from.number} of ${from.login} not found`);
    if (!target) throw new Error(`GitHub Project #${to.number} of ${to.login} not found`);
    const has: Record<CopyField, unknown> = {
      start: target.project.dateFields?.start,
      target: target.project.dateFields?.target,
      size: target.project.estimateFields?.size,
      estimate: target.project.estimateFields?.estimate,
    };
    const lacking = fields.find((key) => !has[key]);
    if (lacking) throw new Error(`GitHub Project #${to.number} of ${to.login} has no ${COPY_FIELD_NAMES[lacking]} field. Run setup_plan to add it, then copy again.`);
    const copied = [...source.items].filter(([issue]) => this.github.issues.has(issue));
    for (const [issue, item] of copied) {
      const next = target.items.get(issue) ?? { status: undefined };
      if (statusOf(item.status) && target.project.statusOptions[statusOf(item.status)!]) next.status = item.status;
      for (const key of fields) if (item[key] !== undefined) next[key] = item[key] as never;
      target.items.set(issue, next);
    }
    // The copied items take the places they hold, in the source's order; the Map is refilled so tests keep their handle.
    const order = copied.map(([issue]) => issue);
    const queue = [...order];
    const entries = [...target.items.keys()].map((issue) => (order.includes(issue) ? queue.shift()! : issue)).map((issue) => [issue, target.items.get(issue)!] as const);
    target.items.clear();
    for (const [issue, item] of entries) target.items.set(issue, item);
    const priorityOf = (issue: number, item: FakePlanItem) => (source.project.priorityOptions ? item.priority : this.issueFieldOf(source) ? this.issuePriorities.get(issue) : undefined);
    return { copied: order, priorities: copied.filter(([issue, item]) => priorityOf(issue, item)).map(([issue]) => issue) };
  }

  async lineage(_repo: RepoRef, issue: number): Promise<PlanAncestor[]> {
    return this.github.ancestorsOf(issue);
  }

  async scopes() {
    return { ...this.scopesAnswer };
  }

  /** The Project of `login` numbered `number`, whichever repository it belongs to. */
  private projectOf({ login, number }: ProjectRef): FakePlan | undefined {
    return [...this.plans.values()].find((p) => p.login === login && p.project.number === number);
  }

  private planOf(repo: RepoRef, number: number): FakePlan | undefined {
    const plan = this.plans.get(keyOf(repo));
    return plan?.project.number === number ? plan : undefined;
  }

  private depthOf(issue: number): number {
    return this.github.depthOf(issue);
  }
}
