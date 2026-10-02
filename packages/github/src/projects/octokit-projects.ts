import { Octokit } from "octokit";
import {
  AddPlanItemDocument,
  CreatePlanProjectDocument,
  IssuePlanDocument,
  LinkPlanRepositoryDocument,
  PlanItemsDocument,
  PlanOwnerIdsDocument,
  PlanProjectDocument,
  SetPlanStatusDocument,
  SetStatusOptionsDocument,
  type AddPlanItemMutation,
  type CreatePlanProjectMutation,
  type IssuePlanQuery,
  type PlanItemsQuery,
  type PlanOwnerIdsQuery,
  type PlanProjectQuery,
  type ProjectV2SingleSelectFieldOptionInput,
  type SetStatusOptionsMutation,
} from "../gql/graphql.ts";
import type { RepoRef } from "../types.ts";
import { kindOf } from "./kinds.ts";
import { STATUS_OPTIONS, type PlanItem, type PlanProject, type PlanStatus, type SetStatusResult } from "./types.ts";

type Fetch = typeof globalThis.fetch;

type GqlItem = NonNullable<NonNullable<NonNullable<PlanItemsQuery["user"]>["projectV2"]>["items"]["nodes"]>[number];

const present = <T>(items: readonly (T | null | undefined)[] | null | undefined): T[] => (items ?? []).filter((x): x is T => x != null);

const asStatus = (name: string | null | undefined): PlanStatus | undefined => STATUS_OPTIONS.find((s) => s === name);

/** How many ancestors a parent chain has, counted up to three. */
function depthOf(parent: { parent?: { parent?: unknown } | null } | null | undefined): number {
  let depth = 0;
  for (let p: { parent?: unknown } | null | undefined = parent; p && depth < 3; p = p.parent as typeof p) depth++;
  return depth;
}

/** ProjectsPort over Octokit with a classic personal token: GitHub Apps cannot reach user-owned Projects. */
export class OctokitProjects {
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

  /** A user's Project with its Status field, or undefined when there is none the token can see. */
  private async projectNode(login: string, number: number) {
    const data = await this.octokit.graphql<PlanProjectQuery>(PlanProjectDocument.toString(), { login, number });
    return data.user?.projectV2 ?? undefined;
  }

  /** The issue and its item in the repository owner's Project `project`, if it is one. */
  private async issuePlan(repo: RepoRef, project: number, number: number) {
    const { repository } = await this.octokit.graphql<IssuePlanQuery>(IssuePlanDocument.toString(), { owner: repo.owner, name: repo.name, number });
    const issue = repository?.issue;
    if (!repository || !issue) throw new Error(`issue ${repo.owner}/${repo.name}#${number} not found`);
    const item = present(issue.projectItems?.nodes).find((i) => i.project.number === project && i.project.owner.id === repository.owner.id);
    return { issue, item };
  }
}

type StatusFieldConfig = { __typename: string; id?: string; options?: { id: string; name: string }[] } | null | undefined;

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
      status: item.status?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? asStatus(item.status.name) : undefined,
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
