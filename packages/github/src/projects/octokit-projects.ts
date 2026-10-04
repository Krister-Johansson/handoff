import { Octokit } from "octokit";
import {
  AddPlanBlockerDocument,
  AddPlanItemDocument,
  AddPlanLabelsDocument,
  AddPlanSubIssueDocument,
  CreatePlanDateFieldDocument,
  CreatePlanEstimateFieldDocument,
  CreatePlanSizeFieldDocument,
  CreatePlanLabelDocument,
  CreatePlanIssueDocument,
  IssueCreateRefsDocument,
  IssueNodeIdDocument,
  CreatePlanProjectDocument,
  IssuePlanDocument,
  LinkPlanRepositoryDocument,
  MovePlanItemDocument,
  PlanItemsDocument,
  PlanOwnerIdsDocument,
  PlanProjectDocument,
  PlanProjectsDocument,
  PlanProjectSetupDocument,
  SetPlanSizeOptionsDocument,
  SetPlanStatusDocument,
  SetStatusOptionsDocument,
  type AddPlanItemMutation,
  type CreatePlanDateFieldMutation,
  type CreatePlanEstimateFieldMutation,
  type CreatePlanSizeFieldMutation,
  type CreatePlanIssueMutation,
  type CreatePlanProjectMutation,
  type IssueCreateRefsQuery,
  type IssueNodeIdQuery,
  type IssuePlanQuery,
  type PlanDateFieldsFragment,
  type PlanEstimateFieldsFragment,
  type PlanItemsQuery,
  type PlanOwnerIdsQuery,
  type PlanProjectChoiceFragment,
  type PlanProjectQuery,
  type PlanProjectSetupQuery,
  type PlanProjectsQuery,
  type ProjectV2SingleSelectFieldOptionInput,
  type SetPlanSizeOptionsMutation,
  type SetStatusOptionsMutation,
} from "../gql/graphql.ts";
import type { RepoRef } from "../types.ts";
import { kindOf, PLAN_KINDS, PLAN_SIZES, sizeOf, STATUS_OPTIONS, statusOf } from "./kinds.ts";
import { ancestorsOf, depthOf, present } from "./lineage.ts";
import { moveItemsDocument } from "./order-moves.ts";
import { planFieldWrites, planItemIdsDocument, setManyPlanFieldsDocument, setPlanFieldsDocument } from "./plan-fields.ts";
import type { AdoptedProject, ItemMove, NewPlanIssue, PlanAncestor, PlanDateFieldIds, PlanDates, PlanEstimateFieldIds, PlanFields, PlanFieldsChange, PlanItem, PlanKind, PlanProject, PlanProjectChoice, PlanSize, PlanStatus, ProjectsPort, SetDatesResult, SetFieldsResult, SetStatusResult } from "./types.ts";

type Fetch = typeof globalThis.fetch;

/**
 * Field writes sent in one request by setManyPlanFields, and moves by moveItems. GitHub documents no cap
 * on mutations per request, but it ends a request that takes more than 10 seconds and runs a request's
 * mutations one after another, so a request stays small; Octokit's throttle spaces the requests one
 * second apart.
 */
const MUTATIONS_PER_REQUEST = 20;
/** Issues looked up in one PlanItemIds query: at most 20 items each, well inside GitHub's node limit. */
const ISSUES_PER_LOOKUP = 100;

/** The items in runs whose writes add up to at most `max` mutations; an item's writes stay in one request. */
function byMutationCount<T extends { writes: unknown[] }>(items: T[], max: number): T[][] {
  const chunks: T[][] = [];
  let count = 0;
  for (const item of items) {
    const last = chunks.at(-1);
    if (!last || count + item.writes.length > max) {
      chunks.push([item]);
      count = item.writes.length;
    } else {
      last.push(item);
      count += item.writes.length;
    }
  }
  return chunks;
}

type GqlItem = NonNullable<NonNullable<NonNullable<PlanItemsQuery["repositoryOwner"]>["projectV2"]>["items"]["nodes"]>[number];
type ProjectNode = NonNullable<NonNullable<PlanProjectQuery["repositoryOwner"]>["projectV2"]>;
/** Whether a user or an organization owns a Project, as GitHub names the owner's type. */
type OwnerType = NonNullable<PlanProject["owner"]>;
/** One of an organization's issue fields as PlanProject reads them. */
type OwnerIssueField = NonNullable<NonNullable<Extract<NonNullable<PlanProjectQuery["repositoryOwner"]>, { __typename: "Organization" }>["issueFields"]>["nodes"]>[number] & {};
/** The name GitHub gives the Priority field, on a Project and among an organization's issue fields. */
const PRIORITY = "Priority";

/** Whether `field(name: "Priority")` found a single select field of the Project's own, not a column showing the organization's issue field. */
function isOwnPriorityField(field: { __typename: string; isIssueField?: boolean } | null | undefined): boolean {
  return field?.__typename === "ProjectV2SingleSelectField" && field.isIssueField !== true;
}

/**
 * Where Priority comes from (docs/plans/organizations.md, Decision 5): the Project's own single select field
 * named Priority, else the organization's single select issue field named Priority with its options in the
 * order of their `priority` number, else none.
 */
function priorityOf(field: ProjectNode["priority"], issueFields: OwnerIssueField[] = []): Pick<PlanProject, "priorityOptions" | "prioritySource"> {
  if (field?.__typename === "ProjectV2SingleSelectField" && isOwnPriorityField(field)) return { priorityOptions: field.options.map((o) => o.name), prioritySource: "project" };
  const issueField = issueFields.find((f) => f.__typename === "IssueFieldSingleSelect" && f.name === PRIORITY);
  if (issueField?.__typename !== "IssueFieldSingleSelect") return { priorityOptions: undefined, prioritySource: undefined };
  // An option without a priority number goes after those with one, in the order GitHub lists them.
  const rank = (priority: number | null) => priority ?? Number.MAX_SAFE_INTEGER;
  const options = [...issueField.options].sort((a, b) => rank(a.priority) - rank(b.priority));
  return { priorityOptions: options.map((o) => o.name), prioritySource: "issue-field" };
}

/** The option name of the item's value in the Project's single select field named Priority; undefined for none or another value type. */
function projectPriorityOf(item: NonNullable<GqlItem>): string | undefined {
  return item.priority?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? (item.priority.name ?? undefined) : undefined;
}

/** The option name of the issue's single select issue field named Priority; undefined without a value or such a field. */
function issuePriorityOf(issue: Extract<NonNullable<GqlItem>["content"], { __typename: "Issue" }>): string | undefined {
  const value = present(issue.issueFieldValues?.nodes).find((v) => v.__typename === "IssueFieldSingleSelectValue" && v.field?.__typename === "IssueFieldSingleSelect" && v.field.name === PRIORITY);
  return value?.__typename === "IssueFieldSingleSelectValue" ? value.name : undefined;
}

/** ProjectsPort over Octokit with a classic personal token: GitHub Apps cannot reach user-owned Projects. */
export class OctokitProjects implements ProjectsPort {
  private constructor(private readonly octokit: Octokit) {}

  /** `throttle: false` turns off Octokit's spacing of GraphQL calls one second apart, for tests. */
  static withToken(token: string, opts: { fetch?: Fetch; throttle?: boolean } = {}): OctokitProjects {
    return new OctokitProjects(
      new Octokit({
        auth: token,
        ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
        ...(opts.throttle === false ? { throttle: { enabled: false } } : {}),
      }),
    );
  }

  async scopes(): Promise<{ project: boolean; classic: boolean }> {
    const { headers } = await this.octokit.request("GET /user");
    // Only classic tokens list their scopes; a fine-grained token cannot reach user-owned Projects.
    const header = headers["x-oauth-scopes"];
    if (header === undefined) return { project: false, classic: false };
    const scopes = String(header)
      .split(",")
      .map((s) => s.trim());
    return { project: scopes.includes("project"), classic: true };
  }

  async getProject(login: string, number: number): Promise<PlanProject | undefined> {
    const { owner, project, issueFields } = await this.projectNode(login, number);
    if (!project) return undefined;
    return {
      number: project.number,
      url: project.url,
      title: project.title,
      owner,
      statusOptions: optionIds(statusField(project.field)),
      dateFields: dateFieldIds(project),
      ...priorityOf(project.priority, issueFields),
      estimateFields: estimateFieldIds(project),
    };
  }

  async getStatus(repo: RepoRef, project: number, issue: number): Promise<PlanStatus | undefined> {
    const { item } = await this.issuePlan(repo, project, issue);
    return item?.status?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? statusOf(item.status.name) : undefined;
  }

  async ensureLabels(repo: RepoRef): Promise<void> {
    const refs = await this.octokit.graphql<IssueCreateRefsQuery>(IssueCreateRefsDocument.toString(), { owner: repo.owner, name: repo.name, parent: 0, withParent: false });
    if (!refs.repository) throw new Error(`repository ${repo.owner}/${repo.name} not found`);
    const have = new Set(present(refs.repository.labels?.nodes).map((l) => l.name.toLowerCase()));
    for (const kind of PLAN_KINDS) {
      if (have.has(kind)) continue;
      await this.octokit.graphql(CreatePlanLabelDocument.toString(), { repositoryId: refs.repository.id, name: kind, ...KIND_LABELS[kind] });
    }
  }

  async listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]> {
    const items: NonNullable<GqlItem>[] = [];
    let ownPriority = false;
    let cursor: string | null | undefined;
    // Paged by hand: a Project without a Priority field answers each page with a NOT_FOUND next to its data,
    // which Octokit's paginate would throw.
    do {
      const data = await this.withOptionalFields<PlanItemsQuery>(PlanItemsDocument.toString(), cursor ? { login, number, cursor } : { login, number });
      const project = data.repositoryOwner?.projectV2;
      if (!project) break;
      ownPriority = isOwnPriorityField(project.priority);
      items.push(...present<NonNullable<GqlItem>>(project.items.nodes));
      cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : undefined;
    } while (cursor);
    // GitHub returns items by POSITION, so an item's index across the pages is its place in the Project.
    return items.flatMap((item, index) => toPlanItem(item, repo, index + 1, ownPriority));
  }

  async setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts: { add?: boolean } = {}): Promise<SetStatusResult> {
    const plan = await this.issuePlan(repo, project, issue);
    let target: { projectId: string; itemId: string; field: StatusFieldConfig } | undefined = plan.item
      ? { projectId: plan.item.project.id, itemId: plan.item.id, field: plan.item.project.field }
      : undefined;
    if (!target && opts.add) {
      const { project: found } = await this.projectNode(repo.owner, project);
      if (found) {
        const added = await this.octokit.graphql<AddPlanItemMutation>(AddPlanItemDocument.toString(), { projectId: found.id, contentId: plan.issue.id });
        const itemId = added.addProjectV2ItemById?.item?.id;
        if (itemId) target = { projectId: found.id, itemId, field: found.field };
      }
    }
    if (!target) return "not-in-project";
    const field = statusField(target.field);
    const optionId = field?.options.find((o) => o.name === status)?.id;
    if (!field || !optionId) return "no-option";
    await this.octokit.graphql(SetPlanStatusDocument.toString(), { projectId: target.projectId, itemId: target.itemId, fieldId: field.id, optionId });
    return "set";
  }

  async listProjects(login: string, repo: RepoRef): Promise<PlanProjectChoice[]> {
    const data = await this.withOptionalFields<PlanProjectsQuery>(PlanProjectsDocument.toString(), { login });
    const choices = present(data.repositoryOwner?.projectsV2.nodes)
      .filter((p) => !p.closed)
      .map((p) => {
        const options = optionIds(choiceStatusField(p));
        return { number: p.number, title: p.title, url: p.url, linked: isLinked(p, repo), missingStatusOptions: STATUS_OPTIONS.filter((s) => !options[s]) };
      });
    return [...choices.filter((c) => c.linked), ...choices.filter((c) => !c.linked)];
  }

  async adoptProject(login: string, number: number, repo: RepoRef): Promise<AdoptedProject> {
    const data = await this.withOptionalFields<PlanProjectSetupQuery>(PlanProjectSetupDocument.toString(), { login, number });
    const owner = data.repositoryOwner?.__typename;
    const project = data.repositoryOwner?.projectV2;
    const field = project ? choiceStatusField(project) : undefined;
    if (!project || !field) throw new Error(`GitHub Project #${number} of ${ownerName(login, owner)} does not exist or has no Status field`);
    const { options, renamed, added } = adoptedOptions(field.options);
    let ids = optionIds(field);
    if (renamed.length || added.length) {
      const updated = await this.octokit.graphql<SetStatusOptionsMutation>(SetStatusOptionsDocument.toString(), { fieldId: field.id, options });
      ids = optionIds(statusField(updated.updateProjectV2Field?.projectV2Field));
    }
    if (!isLinked(project, repo)) {
      const repository = await this.repositoryWithOwner(repo);
      await this.octokit.graphql(LinkPlanRepositoryDocument.toString(), { projectId: project.id, repositoryId: repository.id });
    }
    return { project: { number: project.number, url: project.url, title: project.title, owner, statusOptions: ids, dateFields: dateFieldIds(project) }, renamed, added };
  }

  async createProject(login: string, repo: RepoRef, title: string, opts: { dateFields?: boolean } = {}): Promise<PlanProject> {
    // A repository links only its owner's Projects, so the Project goes to that owner, a user or an organization.
    const repository = await this.repositoryWithOwner(repo);
    const { owner } = repository;
    if (!owner.viewerCanCreateProjects) throw new Error(cannotCreateProjects(login, owner.__typename));
    const created = await this.octokit.graphql<CreatePlanProjectMutation>(CreatePlanProjectDocument.toString(), { ownerId: owner.id, title });
    const project = created.createProjectV2?.projectV2;
    const field = project?.field?.__typename === "ProjectV2SingleSelectField" ? project.field : undefined;
    if (!project || !field) throw new Error(`creating the Project "${title}" returned no Status field`);
    const done = field.options.find((o) => o.name === "Done");
    const options: ProjectV2SingleSelectFieldOptionInput[] = STATUS_OPTIONS.map((name) =>
      // Done keeps its id, so items already in it stay there and GitHub's default Done workflows keep working.
      name === "Done" && done ? { id: done.id, name, color: done.color, description: done.description } : { name, ...STATUS_STYLE[name] },
    );
    const updated = await this.octokit.graphql<SetStatusOptionsMutation>(SetStatusOptionsDocument.toString(), { fieldId: field.id, options });
    const dateFields =
      opts.dateFields === false
        ? { start: undefined, target: undefined }
        : { start: await this.createDateField(project.id, "start"), target: await this.createDateField(project.id, "target") };
    await this.octokit.graphql(LinkPlanRepositoryDocument.toString(), { projectId: project.id, repositoryId: repository.id });
    return { number: project.number, url: project.url, title: project.title, owner: owner.__typename, statusOptions: optionIds(statusField(updated.updateProjectV2Field?.projectV2Field)), dateFields };
  }

  async createIssue(
    repo: RepoRef,
    input: NewPlanIssue,
  ): Promise<{ number: number; url: string }> {
    const refs = await this.octokit.graphql<IssueCreateRefsQuery>(IssueCreateRefsDocument.toString(), {
      owner: repo.owner,
      name: repo.name,
      parent: input.parent ?? 0,
      withParent: input.parent !== undefined,
    });
    if (!refs.repository) throw new Error(`repository ${repo.owner}/${repo.name} not found`);
    const labelIds = labelIdsOf(present(refs.repository.labels?.nodes), input.labels, repo);
    if (input.parent !== undefined && !refs.repository.parent) throw new Error(`parent issue #${input.parent} not found`);
    // Look the blockers up before creating, so a wrong number creates nothing.
    const blockerIds = [];
    for (const blocker of input.blockedBy ?? []) blockerIds.push(await this.issueNodeId(repo, blocker));

    const created = await this.octokit.graphql<CreatePlanIssueMutation>(CreatePlanIssueDocument.toString(), {
      repositoryId: refs.repository.id,
      title: input.title,
      body: input.body,
      labelIds,
      parentIssueId: refs.repository.parent?.id,
    });
    const issue = created.createIssue?.issue;
    if (!issue) throw new Error(`creating the issue "${input.title}" returned nothing`);
    for (const blockingIssueId of blockerIds) await this.octokit.graphql(AddPlanBlockerDocument.toString(), { issueId: issue.id, blockingIssueId });
    await this.setStatus(repo, input.project, issue.number, "Shaping", { add: true });
    await this.setNewDates(repo, input, issue.number);
    return { number: issue.number, url: issue.url };
  }

  async addIssue(repo: RepoRef, input: { project: number; issue: number; labels: string[]; parent?: number }): Promise<void> {
    const refs = await this.octokit.graphql<IssueCreateRefsQuery>(IssueCreateRefsDocument.toString(), {
      owner: repo.owner,
      name: repo.name,
      parent: input.parent ?? 0,
      withParent: input.parent !== undefined,
    });
    if (!refs.repository) throw new Error(`repository ${repo.owner}/${repo.name} not found`);
    const labelIds = labelIdsOf(present(refs.repository.labels?.nodes), input.labels, repo);
    if (input.parent !== undefined && !refs.repository.parent) throw new Error(`parent issue #${input.parent} not found`);
    const issueId = await this.issueNodeId(repo, input.issue);
    if (labelIds.length) await this.octokit.graphql(AddPlanLabelsDocument.toString(), { labelableId: issueId, labelIds });
    if (refs.repository.parent) await this.octokit.graphql(AddPlanSubIssueDocument.toString(), { issueId: refs.repository.parent.id, subIssueId: issueId });
    await this.setStatus(repo, input.project, input.issue, "Shaping", { add: true });
  }

  async ensureDateFields(login: string, number: number): Promise<PlanDateFieldIds> {
    const { owner, project } = await this.projectNode(login, number);
    if (!project) throw missingProject(login, number, owner);
    const ids = dateFieldIds(project);
    for (const key of DATE_KEYS) {
      if (project[key] && !ids[key]) {
        throw new Error(`GitHub Project #${number} has a ${DATE_FIELD_NAMES[key]} field that is not a date field. Rename it on GitHub, then try again.`);
      }
    }
    for (const key of DATE_KEYS) ids[key] ??= await this.createDateField(project.id, key);
    return ids;
  }

  async ensureEstimateFields(login: string, number: number, opts: { estimate?: boolean } = {}): Promise<PlanEstimateFieldIds> {
    const { owner, project } = await this.projectNode(login, number);
    if (!project) throw missingProject(login, number, owner);
    const ids = estimateFieldIds(project);
    // Check both fields first, so a Project with a wrong Estimate does not get a Size either.
    if (project.size && !ids.size) throw new Error(`GitHub Project #${number} has a Size field that is not a single select. Rename it on GitHub, then try again.`);
    if (project.estimate && !ids.estimate) throw new Error(`GitHub Project #${number} has an Estimate field that is not a number field. Rename it on GitHub, then try again.`);
    const existing = project.size?.__typename === "ProjectV2SingleSelectField" ? project.size : undefined;
    const size = existing ? await this.addSizeOptions(existing) : await this.createSizeField(project.id);
    const estimate = ids.estimate ?? (opts.estimate === false ? undefined : await this.createEstimateField(project.id));
    return { size, estimate };
  }

  /**
   * Adds the S, M and L options a Size field lacks after its own options, sending every existing option
   * back with its id so no item loses its value; returns the field's ids. Changes nothing when it has all three.
   */
  private async addSizeOptions(field: { id: string; options: ChoiceOption[] }): Promise<NonNullable<PlanEstimateFieldIds["size"]>> {
    const missing = PLAN_SIZES.filter((name) => !field.options.some((o) => o.name === name));
    if (missing.length === 0) return sizeFieldIds(field);
    const options: ProjectV2SingleSelectFieldOptionInput[] = [
      ...field.options.map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description })),
      ...missing.map((name) => ({ name, ...SIZE_STYLE[name] })),
    ];
    const updated = await this.octokit.graphql<SetPlanSizeOptionsMutation>(SetPlanSizeOptionsDocument.toString(), { fieldId: field.id, options });
    const result = updated.updateProjectV2Field?.projectV2Field;
    if (result?.__typename !== "ProjectV2SingleSelectField") throw new Error("updating the Size field returned no single select field");
    return sizeFieldIds(result);
  }

  /** Creates the Size single select field with the options S, M and L and returns its ids. */
  private async createSizeField(projectId: string): Promise<NonNullable<PlanEstimateFieldIds["size"]>> {
    const options = PLAN_SIZES.map((name) => ({ name, ...SIZE_STYLE[name] }));
    const created = await this.octokit.graphql<CreatePlanSizeFieldMutation>(CreatePlanSizeFieldDocument.toString(), { projectId, name: ESTIMATE_FIELD_NAMES.size, options });
    const field = created.createProjectV2Field?.projectV2Field;
    if (field?.__typename !== "ProjectV2SingleSelectField") throw new Error("creating the Size field returned no single select field");
    return sizeFieldIds(field);
  }

  /** Creates the Estimate number field and returns its id. */
  private async createEstimateField(projectId: string): Promise<string> {
    const created = await this.octokit.graphql<CreatePlanEstimateFieldMutation>(CreatePlanEstimateFieldDocument.toString(), { projectId, name: ESTIMATE_FIELD_NAMES.estimate });
    const field = created.createProjectV2Field?.projectV2Field;
    if (field?.__typename !== "ProjectV2Field") throw new Error("creating the Estimate field returned no number field");
    return field.id;
  }

  /** Sets a new issue's Start and Target, once it is an item; throws naming the issue when they cannot be written. */
  private async setNewDates(repo: RepoRef, input: NewPlanIssue, issue: number) {
    const dates = { ...(input.start ? { start: input.start } : {}), ...(input.target ? { target: input.target } : {}) };
    if (!dates.start && !dates.target) return;
    const result = await this.setDates(repo, input.project, issue, dates);
    if (result !== "set") throw new Error(`Created #${issue}, but could not set its dates: ${result === "no-field" ? "the Project has no Start or Target date field" : "it is not in the Project"}.`);
  }

  /** Creates the Start or Target date field on a Project and returns its id. */
  private async createDateField(projectId: string, key: (typeof DATE_KEYS)[number]): Promise<string> {
    const created = await this.octokit.graphql<CreatePlanDateFieldMutation>(CreatePlanDateFieldDocument.toString(), { projectId, name: DATE_FIELD_NAMES[key] });
    const field = created.createProjectV2Field?.projectV2Field;
    if (field?.__typename !== "ProjectV2Field") throw new Error(`creating the ${DATE_FIELD_NAMES[key]} field returned no date field`);
    return field.id;
  }

  async setDates(repo: RepoRef, project: number, issue: number, dates: PlanDates): Promise<SetDatesResult> {
    const result = await this.setPlanFields(repo, project, issue, dates);
    // Only a Size write can miss an option.
    if (result === "no-option") throw new Error(`setDates got no-option for #${issue}`);
    return result;
  }

  async setPlanFields(repo: RepoRef, project: number, issue: number, fields: PlanFields): Promise<SetFieldsResult> {
    const { item } = await this.issuePlan(repo, project, issue);
    if (!item) return "not-in-project";
    const writes = planFieldWrites({ dates: dateFieldIds(item.project), estimates: estimateFieldIds(item.project) }, fields);
    if (typeof writes === "string") return writes;
    if (writes.length === 0) return "set";
    const { document, variables } = setPlanFieldsDocument(writes);
    await this.octokit.graphql(document, { projectId: item.project.id, itemId: item.id, ...variables });
    return "set";
  }

  async setManyPlanFields(repo: RepoRef, project: number, changes: PlanFieldsChange[]): Promise<{ issue: number; result: SetFieldsResult }[]> {
    const { project: node } = await this.projectNode(repo.owner, project);
    const itemIds = node ? await this.itemIdsOf(repo, node.id, changes.map((c) => c.issue)) : new Map<number, string>();
    const ids = node ? { dates: dateFieldIds(node), estimates: estimateFieldIds(node) } : undefined;
    const checked = changes.map(({ issue, fields }) => {
      const itemId = itemIds.get(issue);
      const writes = ids && itemId ? planFieldWrites(ids, fields) : ("not-in-project" as const);
      return { issue, itemId: itemId ?? "", writes };
    });
    const refused = checked.flatMap(({ issue, writes }) => (typeof writes === "string" ? [{ issue, result: writes }] : []));
    if (refused.length) return refused;

    const items = checked.flatMap(({ issue, itemId, writes }) => (typeof writes === "string" || writes.length === 0 ? [] : [{ issue, itemId, writes }]));
    const written: number[] = [];
    for (const chunk of byMutationCount(items, MUTATIONS_PER_REQUEST)) {
      const { document, variables } = setManyPlanFieldsDocument(chunk);
      try {
        await this.octokit.graphql(document, { projectId: node!.id, ...variables });
      } catch (error) {
        const done = written.length ? `It wrote ${written.map((n) => `#${n}`).join(", ")} first; the rest are unchanged. ` : "";
        throw new Error(`GitHub refused the writes for ${chunk.map((i) => `#${i.issue}`).join(", ")}: ${(error as Error).message}. ${done}`.trim(), { cause: error });
      }
      written.push(...chunk.map((i) => i.issue));
    }
    return changes.map(({ issue }) => ({ issue, result: "set" as const }));
  }

  async moveItems(login: string, number: number, moves: ItemMove[]): Promise<void> {
    if (moves.length === 0) return;
    const { owner, project } = await this.projectNode(login, number);
    if (!project) throw missingProject(login, number, owner);
    let moved = 0;
    for (let at = 0; at < moves.length; at += MUTATIONS_PER_REQUEST) {
      const chunk = moves.slice(at, at + MUTATIONS_PER_REQUEST);
      try {
        // One move, as a drag writes, is the operation codegen checks; several go aliased in one request.
        if (chunk.length === 1) await this.octokit.graphql(MovePlanItemDocument.toString(), { projectId: project.id, ...chunk[0]! });
        else {
          const { document, variables } = moveItemsDocument(chunk);
          await this.octokit.graphql(document, { projectId: project.id, ...variables });
        }
      } catch (error) {
        // GraphQL answers each move that ran with its payload and a failed one with null, next to the errors.
        const { data, errors } = error as { data?: Record<string, unknown> | null; errors?: { message: string }[] };
        const ran = data ? Object.values(data).filter((payload) => payload != null).length : 0;
        const why = Array.isArray(errors) && errors.length ? errors.map((e) => e.message).join("; ") : (error as Error).message;
        throw new Error(`GitHub moved ${moved + ran} of ${moves.length} items in Project order, then refused: ${why}`, { cause: error });
      }
      moved += chunk.length;
    }
  }

  /** The item id in the Project `projectId` of each issue that is one of its items, a hundred issues a request. */
  private async itemIdsOf(repo: RepoRef, projectId: string, issues: number[]): Promise<Map<number, string>> {
    const ids = new Map<number, string>();
    for (let at = 0; at < issues.length; at += ISSUES_PER_LOOKUP) {
      const chunk = issues.slice(at, at + ISSUES_PER_LOOKUP);
      const { document, variables } = planItemIdsDocument(chunk);
      type Found = { repository: Record<string, { projectItems: { nodes: ({ id: string; project: { id: string } } | null)[] | null } } | null> | null };
      let data: Found;
      try {
        data = await this.octokit.graphql<Found>(document, { owner: repo.owner, name: repo.name, ...variables });
      } catch (error) {
        // An issue number the repository lacks answers NOT_FOUND next to the others' data.
        const partial = (error as { data?: Found }).data;
        if (!isNotFound(error) || !partial) throw error;
        data = partial;
      }
      for (const issue of chunk) {
        const item = present(data.repository?.[`i${issue}`]?.projectItems.nodes).find((i) => i.project.id === projectId);
        if (item) ids.set(issue, item.id);
      }
    }
    return ids;
  }

  async lineage(repo: RepoRef, issue: number): Promise<PlanAncestor[]> {
    const { issue: found } = await this.issuePlan(repo, undefined, issue);
    return ancestorsOf(found);
  }

  private async issueNodeId(repo: RepoRef, number: number): Promise<string> {
    const data = await this.octokit.graphql<IssueNodeIdQuery>(IssueNodeIdDocument.toString(), { owner: repo.owner, name: repo.name, number });
    const id = data.repository?.issue?.id;
    if (!id) throw new Error(`issue ${repo.owner}/${repo.name}#${number} not found`);
    return id;
  }

  /**
   * Runs a query that looks up the Start, Target, Size, Estimate or Priority field by name. A Project without one answers
   * with a NOT_FOUND per missing field next to complete data, which is a Project without that field, not an error.
   */
  private async withOptionalFields<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    try {
      return await this.octokit.graphql<T>(document, variables);
    } catch (error) {
      const data = dataDespiteMissingFields(error);
      if (data) return data as T;
      throw error;
    }
  }

  /**
   * The Project `number` of the repository owner `login`, a user or an organization, with its Status, date and
   * Priority fields; `project` is undefined when there is none the token can see. `owner` is the owner's type
   * whenever GitHub knows the login, also next to a Project number it cannot resolve. `issueFields` are an
   * organization's issue fields, none for a user.
   */
  private async projectNode(login: string, number: number): Promise<{ owner: OwnerType | undefined; project: ProjectNode | undefined; issueFields?: OwnerIssueField[] }> {
    try {
      const data = await this.withOptionalFields<PlanProjectQuery>(PlanProjectDocument.toString(), { login, number });
      const owner = data.repositoryOwner;
      return { owner: owner?.__typename, project: owner?.projectV2 ?? undefined, issueFields: owner?.__typename === "Organization" ? present(owner.issueFields?.nodes) : [] };
    } catch (error) {
      if (isNotFound(error)) return { owner: (error as { data?: PlanProjectQuery | null }).data?.repositoryOwner?.__typename, project: undefined };
      throw error;
    }
  }

  /** The repository's node id and its owner's, with the owner's type and whether the token's user can create Projects there. */
  private async repositoryWithOwner(repo: RepoRef) {
    const data = await this.octokit.graphql<PlanOwnerIdsQuery>(PlanOwnerIdsDocument.toString(), { owner: repo.owner, name: repo.name });
    if (!data.repository) throw new Error(`repository ${repo.owner}/${repo.name} not found`);
    return data.repository;
  }

  /** The issue and its item in the repository owner's Project `project`, if it is one. */
  private async issuePlan(repo: RepoRef, project: number | undefined, number: number) {
    // Each of the issue's Projects that lacks Start, Target, Size or Estimate adds a NOT_FOUND, whichever Project the plan is.
    const { repository } = await this.withOptionalFields<IssuePlanQuery>(IssuePlanDocument.toString(), { owner: repo.owner, name: repo.name, number });
    const issue = repository?.issue;
    if (!repository || !issue) throw new Error(`issue ${repo.owner}/${repo.name}#${number} not found`);
    const item = present(issue.projectItems?.nodes).find((i) => i.project.number === project && i.project.owner.id === repository.owner.id);
    return { issue, item };
  }
}

/** The owner of a Project in a sentence: "the organization acme" for an organization, the login alone for a user or an owner GitHub did not name. */
const ownerName = (login: string, owner: OwnerType | undefined) => (owner === "Organization" ? `the organization ${login}` : login);

/** The error for a Project number the owner does not have or the token cannot see. */
const missingProject = (login: string, number: number, owner: OwnerType | undefined) =>
  new Error(`GitHub Project #${number} of ${ownerName(login, owner)} does not exist or GITHUB_TOKEN cannot see it.`);

/** Why setup cannot create the plan's Project: GitHub says the token's user cannot create Projects for this owner. */
function cannotCreateProjects(login: string, owner: OwnerType): string {
  return owner === "Organization"
    ? `Your GitHub account cannot create Projects in ${login}. An organization owner can let members create Projects, or create one and run setup_plan with use.`
    : `Your GitHub account cannot create Projects for ${login}. Create one as ${login}, then run setup_plan with use.`;
}

type ChoiceOption = { id: string; name: string; color: ProjectV2SingleSelectFieldOptionInput["color"]; description: string };

/** The Status field of a Project as setup reads it, with each option's look. */
function choiceStatusField(project: PlanProjectChoiceFragment): { id: string; options: ChoiceOption[] } | undefined {
  const field = project.field;
  return field?.__typename === "ProjectV2SingleSelectField" ? { id: field.id, options: field.options } : undefined;
}

/** Whether a Project is linked to the repository. */
const isLinked = (project: PlanProjectChoiceFragment, repo: RepoRef) =>
  present(project.repositories.nodes).some((r) => r.owner.login.toLowerCase() === repo.owner.toLowerCase() && r.name.toLowerCase() === repo.name.toLowerCase());

/** An option's name without case, emoji or extra spaces, so "✅ ready" matches Ready. */
const bareName = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The Status options a Project gets when handoff adopts it: handoff's five in board order, each
 * keeping the id and look of an option whose bare name matches (renamed when the name differs), new
 * ones for the rest, then every other option unchanged so no item loses its value.
 */
function adoptedOptions(current: ChoiceOption[]) {
  const used = new Set<string>();
  const renamed: { from: string; to: PlanStatus }[] = [];
  const added: PlanStatus[] = [];
  const ours: ProjectV2SingleSelectFieldOptionInput[] = STATUS_OPTIONS.map((status) => {
    const match = current.find((o) => o.name === status) ?? current.find((o) => !used.has(o.id) && bareName(o.name) === bareName(status));
    if (!match) {
      added.push(status);
      return { name: status, ...STATUS_STYLE[status] };
    }
    used.add(match.id);
    if (match.name !== status) renamed.push({ from: match.name, to: status });
    return { id: match.id, name: status, color: match.color, description: match.description };
  });
  const others = current.filter((o) => !used.has(o.id)).map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description }));
  return { options: [...ours, ...others], renamed, added };
}

/** The ids of the named labels among the repository's; throws for a name the repository does not have. */
function labelIdsOf(known: { id: string; name: string }[], names: string[], repo: RepoRef): string[] {
  return names.map((name) => {
    const label = known.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!label) throw new Error(`label "${name}" does not exist on ${repo.owner}/${repo.name}`);
    return label.id;
  });
}

type StatusFieldConfig ={ __typename: string; id?: string; options?: { id: string; name: string }[] } | null | undefined;

/** The data of a GraphQL answer whose only errors are the Start, Target, Size, Estimate and Priority field lookups finding no such field. */
function dataDespiteMissingFields(error: unknown): unknown {
  const { errors, data } = (error ?? {}) as { errors?: { type?: string; path?: (string | number)[] }[]; data?: unknown };
  if (!data || !Array.isArray(errors) || errors.length === 0) return undefined;
  return errors.every((e) => e.type === "NOT_FOUND" && OPTIONAL_FIELD_ALIASES.has(String(e.path?.at(-1)))) ? data : undefined;
}

/** A GraphQL answer whose only errors are NOT_FOUND, as for a Project number nobody has. */
function isNotFound(error: unknown): boolean {
  const errors = (error as { errors?: { type?: string }[] } | null)?.errors;
  return Array.isArray(errors) && errors.length > 0 && errors.every((e) => e.type === "NOT_FOUND");
}

/** The kind labels on the repository, so GitHub's issue list and filters show the hierarchy. */
const KIND_LABELS: Record<PlanKind, { color: string; description: string }> = {
  epic: { color: "5319e7", description: "A goal, made of stories" },
  story: { color: "1d76db", description: "A slice of an epic, made of tasks" },
  task: { color: "0e8a16", description: "One pull request's worth of work" },
};

/** How handoff's Status options look on GitHub's board. An existing Done option keeps its own look. */
const STATUS_STYLE: Record<PlanStatus, Pick<ProjectV2SingleSelectFieldOptionInput, "color" | "description">> = {
  Shaping: { color: "GRAY", description: "Being shaped; not ready to build yet" },
  Ready: { color: "BLUE", description: "Shaped; handoff may start a run on it" },
  Running: { color: "YELLOW", description: "A handoff run is working on it" },
  "In review": { color: "PURPLE", description: "Its pull request is open" },
  Done: { color: "GREEN", description: "Merged or closed" },
};

/** The option id of each handoff Status the field has. */
function optionIds(field: { options: { id: string; name: string }[] } | undefined): PlanProject["statusOptions"] {
  const id = (status: PlanStatus) => field?.options.find((o) => o.name === status)?.id;
  return { Shaping: id("Shaping"), Ready: id("Ready"), Running: id("Running"), "In review": id("In review"), Done: id("Done") };
}

/** The Status field when it is a single select, as GitHub creates it. */
function statusField(field: StatusFieldConfig): { id: string; options: { id: string; name: string }[] } | undefined {
  return field?.__typename === "ProjectV2SingleSelectField" && field.id && field.options ? { id: field.id, options: field.options } : undefined;
}

/**
 * The repository's issue of a PlanItems item as a plan item. `ownPriority` says the Project has a Priority field of
 * its own, whose value wins; without one the issue's Priority issue field gives it.
 */
function toPlanItem(item: NonNullable<GqlItem>, repo: RepoRef, position: number, ownPriority: boolean): PlanItem[] {
  const issue = item.content;
  if (issue?.__typename !== "Issue") return [];
  if (issue.repository.owner.login.toLowerCase() !== repo.owner.toLowerCase() || issue.repository.name.toLowerCase() !== repo.name.toLowerCase()) return [];
  const labels = present(issue.labels?.nodes).map((l) => l.name);
  return [
    {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state === "CLOSED" ? "closed" : "open",
      kind: kindOf(labels, issue.issueType?.name, depthOf(issue.parent)),
      status: item.status?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? statusOf(item.status.name) : undefined,
      parent: issue.parent?.number,
      labels,
      assignees: present(issue.assignees.nodes).map((a) => ({ login: a.login, avatarUrl: a.avatarUrl })),
      subIssues: { total: issue.subIssuesSummary.total, completed: issue.subIssuesSummary.completed },
      blockedBy: present(issue.blockedBy.nodes)
        .filter((b) => b.state === "OPEN")
        .map((b) => b.number),
      blockers: present(issue.blockedBy.nodes).map((b) => b.number),
      position,
      itemId: item.id,
      prNumbers: present(issue.closedByPullRequestsReferences?.nodes).map((pr) => pr.number),
      updatedAt: issue.updatedAt,
      // A single select value of the Project's field wins; with a field of its own and no value, the issue field does not stand in.
      priority: projectPriorityOf(item) ?? (ownPriority ? undefined : issuePriorityOf(issue)),
      start: dateOf(item.start),
      target: dateOf(item.target),
      iteration:
        item.iteration?.__typename === "ProjectV2ItemFieldIterationValue"
          ? { title: item.iteration.title, startDate: item.iteration.startDate, duration: item.iteration.duration }
          : undefined,
      size: item.size?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? sizeOf(item.size.name) : undefined,
      estimate: item.estimate?.__typename === "ProjectV2ItemFieldNumberValue" && item.estimate.number != null && item.estimate.number > 0 ? item.estimate.number : undefined,
    },
  ];
}

const DATE_KEYS = ["start", "target"] as const;
/** The names of the date fields on GitHub, the pair the roadmap layout reads once a person picks them. */
const DATE_FIELD_NAMES = { start: "Start", target: "Target" } as const;
/** The names of the estimate fields on GitHub. */
const ESTIMATE_FIELD_NAMES = { size: "Size", estimate: "Estimate" } as const;
/**
 * The aliases the queries give the field lookups a Project may lack: the date fields (`PlanDateFields`),
 * Size and Estimate (`PlanEstimateFields`), both also inside IssuePlan's items, and Priority (`PlanProject`).
 */
const OPTIONAL_FIELD_ALIASES = new Set<string>([...Object.keys(DATE_FIELD_NAMES), ...Object.keys(ESTIMATE_FIELD_NAMES), "priority"]);

/** The ids of a Project's Start and Target fields, each undefined when missing or not a date field. */
function dateFieldIds(project: PlanDateFieldsFragment): PlanDateFieldIds {
  const id = (field: PlanDateFieldsFragment["start"]) => (field?.__typename === "ProjectV2Field" && field.dataType === "DATE" ? field.id : undefined);
  return { start: id(project.start), target: id(project.target) };
}

/** The ids of a Project's Size single select field with its S, M and L options and of its Estimate number field; undefined for a field it lacks or of another type. */
function estimateFieldIds(project: PlanEstimateFieldsFragment): PlanEstimateFieldIds {
  return {
    size: project.size?.__typename === "ProjectV2SingleSelectField" ? sizeFieldIds(project.size) : undefined,
    estimate: project.estimate?.__typename === "ProjectV2Field" && project.estimate.dataType === "NUMBER" ? project.estimate.id : undefined,
  };
}

/** A Size field's id and the ids of its S, M and L options; its other options are not handoff's sizes. */
function sizeFieldIds(field: { id: string; options: { id: string; name: string }[] }): NonNullable<PlanEstimateFieldIds["size"]> {
  const optionId = (name: PlanSize) => field.options.find((o) => o.name === name)?.id;
  return { id: field.id, options: { S: optionId("S"), M: optionId("M"), L: optionId("L") } };
}

/** How handoff's Size options look on GitHub's board; the descriptions say what each size means. */
const SIZE_STYLE: Record<PlanSize, Pick<ProjectV2SingleSelectFieldOptionInput, "color" | "description">> = {
  S: { color: "GREEN", description: "A change in one place" },
  M: { color: "YELLOW", description: "A feature across a few files" },
  L: { color: "ORANGE", description: "A change across several areas" },
};

/** The day of a date field's value; undefined when the item has none or the field is not a date field. */
function dateOf(value: { __typename: string; date?: string | null } | null | undefined): string | undefined {
  return value?.__typename === "ProjectV2ItemFieldDateValue" ? (value.date?.slice(0, 10) ?? undefined) : undefined;
}
