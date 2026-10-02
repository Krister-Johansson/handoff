import { Octokit } from "octokit";
import {
  AddPlanBlockerDocument,
  AddPlanItemDocument,
  AddPlanLabelsDocument,
  AddPlanSubIssueDocument,
  CreatePlanLabelDocument,
  CreatePlanIssueDocument,
  IssueCreateRefsDocument,
  IssueNodeIdDocument,
  CreatePlanProjectDocument,
  IssuePlanDocument,
  LinkPlanRepositoryDocument,
  PlanItemsDocument,
  PlanOwnerIdsDocument,
  PlanProjectDocument,
  SetPlanStatusDocument,
  SetStatusOptionsDocument,
  type AddPlanItemMutation,
  type CreatePlanIssueMutation,
  type CreatePlanProjectMutation,
  type IssueCreateRefsQuery,
  type IssueNodeIdQuery,
  type IssuePlanQuery,
  type PlanItemsQuery,
  type PlanOwnerIdsQuery,
  type PlanProjectQuery,
  type ProjectV2SingleSelectFieldOptionInput,
  type SetStatusOptionsMutation,
} from "../gql/graphql.ts";
import type { RepoRef } from "../types.ts";
import { kindOf, PLAN_KINDS, STATUS_OPTIONS, statusOf } from "./kinds.ts";
import { ancestorsOf, depthOf, present } from "./lineage.ts";
import type { PlanAncestor, PlanItem, PlanKind, PlanProject, PlanStatus, ProjectsPort, SetStatusResult } from "./types.ts";

type Fetch = typeof globalThis.fetch;

type GqlItem = NonNullable<NonNullable<NonNullable<PlanItemsQuery["user"]>["projectV2"]>["items"]["nodes"]>[number];

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
    const project = await this.projectNode(login, number);
    if (!project) return undefined;
    return { number: project.number, url: project.url, title: project.title, statusOptions: optionIds(statusField(project.field)) };
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
    const data = await this.octokit.graphql.paginate<PlanItemsQuery>(PlanItemsDocument.toString(), { login, number });
    return present<NonNullable<GqlItem>>(data.user?.projectV2?.items.nodes).flatMap((item) => toPlanItem(item, repo));
  }

  async setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts: { add?: boolean } = {}): Promise<SetStatusResult> {
    const plan = await this.issuePlan(repo, project, issue);
    let target: { projectId: string; itemId: string; field: StatusFieldConfig } | undefined = plan.item
      ? { projectId: plan.item.project.id, itemId: plan.item.id, field: plan.item.project.field }
      : undefined;
    if (!target && opts.add) {
      const found = await this.projectNode(repo.owner, project);
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

  async createProject(login: string, repo: RepoRef, title: string): Promise<PlanProject> {
    const ids = await this.octokit.graphql<PlanOwnerIdsQuery>(PlanOwnerIdsDocument.toString(), { login, owner: repo.owner, name: repo.name });
    if (!ids.user || !ids.repository) throw new Error(`user ${login} or repository ${repo.owner}/${repo.name} not found`);
    const created = await this.octokit.graphql<CreatePlanProjectMutation>(CreatePlanProjectDocument.toString(), { ownerId: ids.user.id, title });
    const project = created.createProjectV2?.projectV2;
    const field = project?.field?.__typename === "ProjectV2SingleSelectField" ? project.field : undefined;
    if (!project || !field) throw new Error(`creating the Project "${title}" returned no Status field`);
    const done = field.options.find((o) => o.name === "Done");
    const options: ProjectV2SingleSelectFieldOptionInput[] = STATUS_OPTIONS.map((name) =>
      // Done keeps its id, so items already in it stay there and GitHub's default Done workflows keep working.
      name === "Done" && done ? { id: done.id, name, color: done.color, description: done.description } : { name, ...STATUS_STYLE[name] },
    );
    const updated = await this.octokit.graphql<SetStatusOptionsMutation>(SetStatusOptionsDocument.toString(), { fieldId: field.id, options });
    await this.octokit.graphql(LinkPlanRepositoryDocument.toString(), { projectId: project.id, repositoryId: ids.repository.id });
    return { number: project.number, url: project.url, title: project.title, statusOptions: optionIds(statusField(updated.updateProjectV2Field?.projectV2Field)) };
  }

  async createIssue(
    repo: RepoRef,
    input: { project: number; title: string; body: string; labels: string[]; parent?: number; blockedBy?: number[] },
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

  /** A user's Project with its Status field, or undefined when there is none the token can see. */
  private async projectNode(login: string, number: number) {
    try {
      const data = await this.octokit.graphql<PlanProjectQuery>(PlanProjectDocument.toString(), { login, number });
      return data.user?.projectV2 ?? undefined;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  /** The issue and its item in the repository owner's Project `project`, if it is one. */
  private async issuePlan(repo: RepoRef, project: number | undefined, number: number) {
    const { repository } = await this.octokit.graphql<IssuePlanQuery>(IssuePlanDocument.toString(), { owner: repo.owner, name: repo.name, number });
    const issue = repository?.issue;
    if (!repository || !issue) throw new Error(`issue ${repo.owner}/${repo.name}#${number} not found`);
    const item = present(issue.projectItems?.nodes).find((i) => i.project.number === project && i.project.owner.id === repository.owner.id);
    return { issue, item };
  }
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

function toPlanItem(item: NonNullable<GqlItem>, repo: RepoRef): PlanItem[] {
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
      assignees: present(issue.assignees.nodes).map((a) => a.login),
      subIssues: { total: issue.subIssuesSummary.total, completed: issue.subIssuesSummary.completed },
      blockedBy: present(issue.blockedBy.nodes)
        .filter((b) => b.state === "OPEN")
        .map((b) => b.number),
      prNumbers: present(issue.closedByPullRequestsReferences?.nodes).map((pr) => pr.number),
      updatedAt: issue.updatedAt,
    },
  ];
}
