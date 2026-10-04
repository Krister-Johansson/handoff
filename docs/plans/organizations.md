# Plans for repositories owned by a GitHub organization

## Context

Issue #575 asks for the full plan features on a repository owned by a GitHub organization: `setup_plan`, Status writes from runs, the shaping tools, Flow and Timeline modes and the scheduler. User-owned repositories keep working as they do today.

ADR 0007 made GitHub Projects the plan store for a personal account and named organizations as the upgrade path: "issue types become the kind marker, the Project can be organization-owned, and GitHub sends webhooks for organization Projects" (`docs/adr/0007-github-projects-is-the-plan-store.md:25`). `docs/plans/project-management.md:29` left organizations out of the first plan for the same reason. This plan takes that path. It reads and writes Projects of either owner type, decides where Priority comes from in an organization, checks that organization issue types do not fight the kind labels, says what an organization asks of the token, and gives a way to move an existing project when its repository moves from a user to an organization.

The issue lists eight requirements from a planning session. Each claim in them is checked below under "The requirements, checked", with what held and what did not.

Read `CLAUDE.md`, `GLOSSARY.md`, `docs/plan.md`, ADR 0007, `docs/plans/project-management.md`, `docs/plans/scheduler.md` and `docs/plans/flow.md` first.

## Goals

- A repository owned by an organization gets a plan on a Project owned by that organization: `setup_plan` creates or adopts it and links it, `list_github_projects` lists the organization's Projects, and every read and write of the plan works on it.
- Status, Size, Estimate, Start, Target, Project order, the shaping tools, Flow and Timeline modes and the scheduler behave the same for both owner types.
- In an organization, Priority order can use the organization's Priority issue field, with one stated rule for which Priority wins.
- When GitHub refuses the token for an organization (a missing scope, SSO not authorized, classic tokens blocked), the Plan page, the shaping tools, the scheduler and run events say which and what to do.
- A project whose repository moved from a user to an organization can be re-linked, and its plan copied into an organization Project.
- User-owned repositories answer exactly as today, checked by the existing tests with their assertions unchanged.

## Non-goals

- The GitHub App path to Projects and fine-grained tokens for Projects (open questions 4 and 5). The Projects port keeps using `GITHUB_TOKEN` as a classic token.
- Setting issue types. handoff keeps the labels `epic`, `story` and `task` as the kind marker.
- Organization issue fields other than Priority. Start, Target, Size and Estimate stay Project fields (open question 3).
- Projects webhooks (`projects_v2_item`) to wake the scheduler or refresh the Plan page. Sync stays reads on demand (open question 6).
- Moving a repository from an organization back to a user, or between organizations. The re-link works for any move, but only user to organization is tested.
- Creating organizations, Projects or repositories from handoff's tests. The manual check uses an organization the user creates.

## Verified facts

Code facts are from `main` at `b020678`, read on 2026-10-04. Live facts come from read-only `gh api graphql` calls the same day as `Krister-Johansson`, whose token is classic with `X-Oauth-Scopes: admin:public_key, gist, project, read:org, repo, workflow`. Documentation facts were read the same day; each has its URL.

### Where the port names the owner

- Five operations read a Project through `user(login: $login)`: `PlanItems` (`packages/github/src/queries/plan-items.graphql:1-3`), `PlanOwnerIds` (`plan-project.graphql:41-48`), `PlanProjects` (`:81-89`), `PlanProjectSetup` (`:91-97`) and `PlanProject` (`:99-129`).
- The other reads go through the repository and work for any owner: `IssuePlan`, `IssueNodeId` and `IssueCreateRefs` (`issue-plan.graphql:1-110`), `IssueParents` (`issue-lineage.graphql:42-43`), the generated `PlanItemIds` (`packages/github/src/projects/plan-fields.ts:70-77`) and `PullRequestSnapshot` (`pull-request.graphql:1-2`). Every mutation in `plan-mutations.graphql` and in the generated documents takes node ids.
- `issuePlan` finds the plan's item by Project number and by `project.owner.id === repository.owner.id` (`octokit-projects.ts:474-481`, match at `:479`), so it is owner-neutral already. `getStatus`, `setStatus` on an item that exists, `setPlanFields`, `setDates`, `lineage`, `ensureLabels` and `addIssue`'s labels and sub-issue link need no change.
- Each method that reads the Project node calls `projectNode(login, number)` (`:463-471`) or a `user(login:)` query directly: `getProject` (`:111-123`), `listItems` (`:140-144`, with the generated type `GqlItem` at `:83` built from `PlanItemsQuery["user"]`), `setStatus` with `add` (`:151-158`), `listProjects` (`:167-176`), `adoptProject` (`:178-195`), `createProject` (`:197-216`, owner id from `PlanOwnerIds` at `:198-200`), `ensureDateFields` (`:266-277`), `ensureEstimateFields` (`:279-290`), `setManyPlanFields` (`:361`) and `moveItems` (`:387-410`).
- Every caller passes the repository owner's login as `login`: the Plan page (`apps/web/src/server/plan.ts:103-104`), the shaping tools (`apps/web/src/server/shaping.ts:60`, `:86-112`, `:130` and on), the scheduler (`packages/engine/src/backlog-scheduler/tick.ts:137-142`, `apps/web/src/server/scheduler.ts:76`), `startRun` (`packages/engine/src/start-run.ts:77`), order writes (`apps/web/src/server/flow-order.ts:57`, `:72`), `splitPlan` (`apps/web/src/server/graphs.ts:229-232`), readiness (`apps/web/src/server/readiness.ts:115`), Settings (`apps/web/src/server/project-admin.ts:151`, the project settings page `:30-36`) and search (`apps/web/src/server/search.ts:142`).
- `toPlanItem` drops an item whose issue's repository owner login or name differs from the project's (`octokit-projects.ts:576`).
- `kindOf` reads the kind label first, then an issue type named like a kind, then the depth in the sub-issue tree (`packages/github/src/projects/kinds.ts:23-33`). `PlanItems` and `IssuePlan` select `issueType { name }` (`plan-items.graphql:87-89`, `issue-plan.graphql:39-41`). `FakeProjects` passes no issue type (`packages/github/src/testing/fake-projects.ts:107`).
- `FakeProjects` keeps one Project per repository with the login it was created for (`fake-projects.ts:42`) and finds a Project by login and number (`:88`). It has no owner type.
- Priority: `PlanItems` reads `fieldValueByName(name: "Priority")` as a `ProjectV2ItemFieldSingleSelectValue` (`plan-items.graphql:31-37`); `PlanProject` reads the field's options in order (`plan-project.graphql:118-126`). `orderTasks` ranks by the option's index (`packages/engine/src/backlog-scheduler/candidates.ts:25-39`). `startScheduler` refuses Priority order when `getProject` has no `priorityOptions` (`apps/web/src/server/scheduler.ts:73-79`).

### Access checks today

- `scopes()` reads `X-OAuth-Scopes` from `GET /user` and answers `{ project, classic }` (`octokit-projects.ts:100-109`). `projectsAccessProblem` turns that into one sentence for the whole dashboard (`apps/web/src/server/plan.ts:55-65`), and the worker checks once at start (`apps/worker/src/plan-status.ts:12-31`). Both say a classic token is needed for "a user-owned Project".
- `projectsFromEnv` builds the port from `GITHUB_TOKEN` only (`packages/github/src/projects/from-env.ts:4-10`). The GitHub App path exists for issues and pull requests (`packages/github/src/from-env.ts:6-12`, `octokit-client.ts:101-126`) and finds the installation per repository with `getRepoInstallation` unless `RepoRef.installationId` is set (`:106-110`). Nothing sets it from `projects.github_installation_id`.
- A write that fails during a run becomes `plan.skipped` with the error's message as its reason (`packages/engine/src/plan-status.ts:40-44`).

### What handoff stores about a repository

- `projects`: `repo_owner`, `repo_name`, `repo_id` (GitHub's numeric id, unique), `github_installation_id` (never written), `local_clone_path` and `plan_project_number`, "the number of the repository owner's GitHub Project" (`packages/db/src/schema/projects.ts:31-36`, `:58-59`).
- `plan_pins` keyed by `(project_id, issue)` (`packages/db/src/schema/plan-pins.ts:18-28`).
- `runs.issues`: number, title and the issue's URL (`packages/db/src/schema/runs.ts:29`). Pull request and branch links are built from `repo_owner` and `repo_name` when a page renders (for example `apps/web/src/server/agent-mcp.ts:228`, `apps/web/src/app/projects/[projectId]/runs/[runId]/page.tsx:106`).
- `webhook_deliveries.repo_id`, and the PR node waits on `gh:pr:<repoId>:<number>` (`apps/web/src/server/github-webhook.ts:26-47`, `packages/github/src/webhook-events.ts:1-35`).
- The worker clones into `<HANDOFF_HOME>/repos/<sha1 of the remote URL>` (`packages/engine/src/workdir/git-worktree.ts:27`); the remote is `https://github.com/<repo_owner>/<repo_name>.git` unless `local_clone_path` is set (`packages/engine/src/runs.ts:42-43`). `handoff gc` does not remove clones (`apps/worker/src/gc.ts`).
- `createProject` stores `repo_id` from `getRepoId` when GitHub is configured (`apps/web/src/server/graphs.ts:44-62`). `add_project` refuses a repository whose `owner/name` matches a project (`agent-mcp.ts:407-413`), not one whose id matches.

### Live, read only

- `user(login: "github")` answers `data.user: null` with an error of type `NOT_FOUND`: "Could not resolve to a User with the login of 'github'." So today an organization owner makes `projectNode` return undefined (`isNotFound`, `octokit-projects.ts:541-544`) and makes `listItems` and `listProjects` throw.
- `repositoryOwner(login:)` with `... on ProjectV2Owner { projectsV2 { totalCount } }` answered for `Krister-Johansson` (`__typename: User`, 5 Projects) and for the organization `Task-Insight` (`__typename: Organization`, 0 Projects) in one request costing 1 point. The vendored schema agrees: `repositoryOwner` returns `RepositoryOwner` (`packages/github/src/schema/schema.docs.graphql:48305`), and `User` and `Organization` implement both `RepositoryOwner` and `ProjectV2Owner` (`:71919`, `:35389`).
- `Krister-Johansson` is an admin of `Task-Insight`, which holds the repositories `taskinsight`, `auth`, `web`, `dashboard` and `mobile`. `viewerCanCreateProjects` is true on both the user and that organization.
- `Task-Insight` has the issue types Task, Bug and Feature, all enabled, and the issue fields Priority (single select: Urgent, High, Medium, Low with `priority` 1 to 4), Start date (date), Target date (date) and Effort (single select: High, Medium, Low). Its repository `web` inherits all of them through `Repository.issueTypes` and `Repository.issueFields`.
- On the user-owned `Krister-Johansson/handoff`, `issueTypes` and `issueFields` are null, `owner.__typename` is `User`, and `issueFieldValues(first: 10)` on issue #575 is an empty list with no error.

### The vendored schema

- `createProjectV2` takes `ownerId` of type Organization or User and an optional `repositoryId` (`schema.docs.graphql:9047-9072`). `copyProjectV2` takes `projectId`, `ownerId`, `title` and `includeDraftIssues` (`:7809-7829`). There is no mutation that transfers a ProjectV2 or moves items between Projects.
- `ProjectV2Owner.projectsV2` takes `minPermissionLevel` (READ, WRITE or ADMIN; default READ) and `query` (`:42940-42995`, `:43004-43014`).
- Issue fields: `Organization.issueFields` (`:35703`), `Repository.issueFields`, "inherited from the organization" (`:55021`), `Issue.issueFieldValues` (`:20418`), the unions `IssueFields` and `IssueFieldValue` (`:22551`, `:22426`), `IssueFieldSingleSelectOption` with `name` and `priority`, "The option's priority order", and `IssueFieldSingleSelectValue` with `name` and `optionId`. Writes go through `setIssueFieldValue` (`:29099`, input `:61067-61082`).
- In a Project, a field can stand for an issue field: `ProjectV2SingleSelectField` has `isIssueField` and `issueField` (`:43099-43104`), and an item's value for it is `ProjectV2ItemIssueFieldValue` (`:42529-42539`), which is in the `ProjectV2ItemFieldValue` union (`:42406-42419`). `createProjectV2IssueField` adds an issue field to a Project (`:27971`, input `:9077-9103`).

### GitHub's documentation

- Linking: a repository lists only Projects "owned by the same user or organization that owns the repository" (https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository). The page describes the UI; the API rule is unverified.
- A Project can hold "issues and pull requests from any organization" (https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/adding-items-to-your-project).
- Copying a Project: the copy "will not contain the original project's items" (https://docs.github.com/en/issues/planning-and-tracking-with-projects/creating-projects/copying-an-existing-project).
- "Move work to an organization" in account settings can "transfer repositories and projects from your personal account" (https://docs.github.com/en/account-and-profile/how-tos/account-management/moving-your-work-to-an-organization).
- Transferring a repository: issues, pull requests, wiki, stars and watchers move with it; "All links to the previous repository location are automatically redirected"; from a user to an organization only assignees who are members stay; from an organization to a user "all issue types are removed from issues" (https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository). The page says nothing about Projects (v2), node ids or the old owner's Projects.
- Classic scopes: `project` "Grants read/write access to user and organization projects"; `read:project` is the read-only version (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). The Projects API guide names only `read:project` for queries and `project` for mutations (https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).
- Fine-grained tokens have an organization permission "Projects" and cannot reach Projects owned by a user account (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). GitHub Apps have the same organization permission "Projects" and no permission for a user's Projects (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
- An organization can restrict classic tokens and fine-grained tokens separately; both are allowed by default; a restricted classic token gets a 403; fine-grained tokens need approval by default (https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).
- Under SAML SSO a classic token must be authorized for the organization. Without it GitHub answers 404 or 403, and on a 403 the `X-GitHub-SSO` header "will include a URL" to authorize the token (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api).
- Issue fields are generally available since 2026-07-02 (https://github.blog/changelog/2026-07-02-issue-fields-are-now-generally-available/). The defaults are Priority, Effort, Start date and Target date; fields are defined per organization and apply to all its repositories (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-an-organization). In a Project an issue field "appears as a column in the table view", edits sync back to the issue, it only applies to issues of the same organization, and a Project's own Priority field can exist next to it; the docs warn that two Priority fields confuse people (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-issue-fields).
- Issue types: "The default types are task, bug, and feature", configured per organization (https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization).
- Sub-issues: up to 100 per parent and eight levels (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues). Dependencies: up to 50 issues per relationship type (https://github.blog/changelog/2025-08-21-dependencies-on-issues/). Neither source separates user and organization repositories.
- `projects_v2`, `projects_v2_item` and `projects_v2_status_update` webhooks are for organization-level Projects, with availability "organization" only (https://docs.github.com/en/webhooks/webhook-events-and-payloads).
- Organization members can create Projects by default; the organization switch is "Enable Projects for the organization" (https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization, https://docs.github.com/en/organizations/managing-organization-settings/disabling-project-boards-in-your-organization).
- Octokit's `GraphqlResponseError` carries `headers`, `errors` (each with `type`) and `data` (Context7, `/octokit/octokit.js`).

## Unverified

- Whether `read:org` is ever needed to read or write an organization's Projects. The docs name only `project`. PR 3's manual step uses a classic token with `repo` and `project` only.
- The text and `type` of GitHub's answer when a classic token lacks a scope. A user report quotes "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']" (https://github.com/cli/cli/issues/11308); the `type` is believed to be `INSUFFICIENT_SCOPES`. PR 2's tests start from that text, and PR 3's manual step records a real one.
- The GraphQL body of a 403 for a token not authorized for SSO, and for an organization that blocks classic tokens. The docs give the status and the `X-GitHub-SSO` header only.
- Whether `linkProjectV2ToRepository` refuses a Project of another owner through the API, and with what message.
- Whether a repository keeps its numeric id and node id when it is transferred, whether its issues keep their numbers, and whether they stay items of the old owner's Projects.
- Whether `repository(owner: "<old owner>", name:)` in GraphQL follows a transfer, and whether `git fetch` on the old remote URL keeps working.
- Whether "Move work to an organization" keeps a Project's number.
- Whether a Project that shows the organization's Priority issue field answers `field(name: "Priority")` with that field, and `fieldValueByName(name: "Priority")` with a `ProjectV2ItemIssueFieldValue`. Whether a Project can hold its own field named Priority and the issue field at once under the same name.
- The rate cost of `issueFieldValues(first: 10)` on each of 100 items in `PlanItems`.
- Whether `addProjectV2ItemById` puts new items at the end of Project order, in the order they were added.
- Whether GitHub sets an issue type on an issue created through the API in an organization when `issueTypeId` is left out.

## The requirements, checked

1. "Every plan query reads `user(login: $login)`." Partly. Five of the eleven operations do (Verified facts); the issue reads go through `repository(owner:, name:)` and every mutation takes node ids, so Status writes on items that exist already work for an organization. An organization owner makes `user(login:)` answer `NOT_FOUND`, not an empty result. The suggested fix of reading `repository.owner.__typename` and then `organization(login:)` or `user(login:)` works but costs a round trip; `repositoryOwner(login:)` with `... on ProjectV2Owner` reads either owner in the same request and returns the type (Decision 1, verified live).
2. "GitHub only lets a repository link Projects owned by the same owner." Holds for the UI per the docs; the API's behaviour is unverified. `createProjectV2` accepts an organization's node id (schema).
3. Status, fields, order, the shaping tools, both modes and `start_scheduler` on an organization Project. Holds as a goal. The work is in the Project reads; the writes are owner-neutral.
4. "Organizations now have a default Priority issue field." Holds: issue fields are generally available since 2026-07-02, Priority is a default field, and `Task-Insight` has it with Urgent, High, Medium and Low. The GraphQL types exist in the vendored schema. Decision 5 picks the source.
5. "Organizations have default issue types, one named task." Holds: Task, Bug and Feature (the docs write them lower case; GitHub returns "Task"). They do not conflict with the labels (Decision 6). Sub-issues and blocked-by: the docs give the same limits and no difference between owner types.
6. "Classic token: repo, project, read:org as far as known." Partly. `project` is the documented scope for user and organization Projects; `repo` is what handoff already needs for private repositories' issues; `read:org` is not documented as needed (unverified, checked in PR 3). Organizations can block classic tokens and require SSO authorization: holds per the docs.
7. Moving a project. A user Project cannot be linked to the organization's repository per the docs, items cannot be moved between Projects, and `copyProjectV2` copies no items. One more path exists: "Move work to an organization" moves Projects with repositories. Decision 9.
8. Tests for both owner types and a manual check in a test organization. Holds. `Krister-Johansson` already administers `Task-Insight`, which holds real repositories, so the plan asks for a separate test organization (open question 10).

## Decisions

### 1. Read Projects through `repositoryOwner`, for either owner type

The five operations replace `user(login: $login)` with `repositoryOwner(login: $login) { __typename ... on ProjectV2Owner { ... } }`. One request reads a user's or an organization's Project, as today's one request reads a user's, and `__typename` tells the port the owner type. No new query runs first, and no caller changes: they keep passing the repository owner's login.

`PlanProject` gains `owner: "User" | "Organization"`, optional like `dateFields`. handoff stores no owner type: the repository's owner can change (Decision 9), and the type comes with every Project read for free.

`PlanOwnerIds` becomes `repository(owner:, name:) { id owner { __typename id ... on User { viewerCanCreateProjects } ... on Organization { viewerCanCreateProjects } } }`, so `createProject` creates the Project under the repository's owner, whatever it is, and refuses before creating anything when the token's user cannot: "Your GitHub account cannot create Projects in Task-Insight. An organization owner can let members create Projects, or create one and run setup_plan with use."

`listProjects` asks for `minPermissionLevel: WRITE` for both owner types, so it lists only Projects the token can write. A user's own Projects are all writable by that user, so the user list does not change; an organization with many Projects shows only the ones setup could use. `adoptProject` takes any number, listed or not, as today.

Messages that say "a user's Project" or "of <login>" name the owner type: "GitHub Project #3 of the organization Task-Insight does not exist or GITHUB_TOKEN cannot see it."

### 2. Writes stay as they are

Every write already names node ids, and `issuePlan` matches the plan's item by Project number and owner id. The methods that read the Project node first (`setStatus` with `add`, `setManyPlanFields`, `moveItems`, `ensureDateFields`, `ensureEstimateFields`, `adoptProject`, `createProject`) follow Decision 1 through `projectNode`. `createIssue` sets no issue type.

### 3. Access problems are named where GitHub reports them

The global check stays: `GITHUB_TOKEN` is a classic token with `project`. Organization problems show only when handoff calls that organization, so the port turns GitHub's refusals into one error type, `ProjectsAccessError`, with a `reason` and a sentence, in `packages/github/src/projects/access.ts`. One private wrapper in `OctokitProjects` sends every GraphQL request and converts:

| GitHub answers | `reason` | Sentence |
|---|---|---|
| An error whose `type` is `INSUFFICIENT_SCOPES`, or whose message says the token "has not been granted the required scopes" | `scope` | "GITHUB_TOKEN lacks the read:project scope that GitHub asks for here. Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token)." The scope is the one GitHub's message names. |
| A 403 with `X-GitHub-SSO: required; url=...` | `sso` | "Task-Insight uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. Authorize the token at <url> within the hour, or on GitHub under Settings, Developer settings, Personal access tokens, Configure SSO." |
| A 403 whose message says the organization forbids classic tokens | `classic-blocked` | "Task-Insight does not accept classic personal access tokens, and handoff reads Projects with one. An organization owner can allow them under Settings, Personal access tokens." |
| `NOT_FOUND` on `repositoryOwner` or `projectV2` | (undefined, as today) | Today's "does not exist or GITHUB_TOKEN cannot see it", with the owner type. |

The Plan page's `loadPlan` catches the error and shows it as `PlanUnavailable` with reason `no-scope`; `shapingAccess`, `startScheduler` and readiness's plan check show the sentence; a run's status write records it as the `plan.skipped` reason through the existing catch. The worker's start check and `projectsAccessProblem` keep their global role, with wording for both owner types: "a classic token with the project scope, which reaches user and organization Projects".

A fine-grained token keeps being refused, with a sentence that says why for both: "GITHUB_TOKEN is a fine-grained token. A fine-grained token cannot reach a Project owned by a user, and handoff reads every Project with one classic token with the project scope." A GitHub App alone keeps giving no Projects port, and the sentence says the App path is not built for Projects (open question 5).

### 4. Tokens for an organization

The documented requirement is a classic token with `project`, plus `repo` for a private repository's issues, which handoff already needs. `read:org` is not required and not checked; PR 3's manual step confirms that a token with `repo` and `project` only works on an organization Project. If it does not, PR 3 adds `read:org` to `scopes()` for organization owners and to the sentences.

Two organization settings can still stop a valid token, and Decision 3 names both: SSO authorization and a block on classic tokens. Fine-grained token approval does not apply, since handoff does not accept fine-grained tokens for Projects.

### 5. Priority: the Project's own field, else the organization's issue field

Every organization now has a Priority issue field by default, on every issue, whether or not anyone sets it. A team may also have a single select Priority on its Project, which is what handoff reads today. The rule:

1. A single select field named Priority that the Project defines itself (`isIssueField` false) wins, for both owner types. This is today's behaviour, and a person who built that field on the Project meant it.
2. Otherwise, when the repository's owner is an organization with a single select issue field named Priority, handoff reads that issue field: each issue's value from `issueFieldValues` on the issue, and the options in the order of their `priority` number (Urgent first in `Task-Insight`). This applies whether or not the Project shows the issue field as a column.
3. Otherwise there is no Priority, and `start_scheduler` refuses Priority order as today, with a sentence that names both ways: "GitHub Project #3 has no Priority field and Task-Insight has no Priority issue field, so the scheduler cannot order tasks by priority. Add a single select field named Priority, or use Project order."

Reading the value from the issue, not from the Project item, avoids depending on how GitHub answers `fieldValueByName` for a column backed by an issue field (unverified), and gives the same value either way, since the docs say the column syncs with the issue. `PlanItems` selects `issueFieldValues(first: 10)` on each issue with the single select value's field name, and the Project's `field(name: "Priority") { ... on ProjectV2SingleSelectField { isIssueField options { name } } }`; `toPlanItem` sets `priority` from the source the rule picks. `PlanProject` gains `prioritySource: "project" | "issue-field"` next to `priorityOptions`, and `PlanProject`'s query reads the owner's issue fields in the same request with `... on Organization { issueFields(first: 25) }`. `candidates`, the Flow's Optimize rank and `arrange_plan` need no change: they read `priority` and `priorityOptions`.

The scheduler card, Project settings and `get_scheduler` say which source orders the tasks: "Priority order, from the organization's Priority issue field" or "from the Project's Priority field". handoff never writes Priority, as today.

The rejected alternative, the issue field always winning in an organization, would silently turn a team's Project Priority off the day the organization's default field appeared, since every issue has the empty default.

### 6. Issue types and the kind labels do not conflict

handoff sets no issue type and keeps the labels `epic`, `story` and `task`. A label and an issue type are separate objects on GitHub, so a repository can have a `task` label and the organization a Task type. `kindOf`'s order stays: the label wins, then a type named like a kind, then depth. The effects in an organization:

- Issues the shaping tools create or plan always carry a kind label, so their type never decides.
- An issue in the Project without a kind label and typed Task reads as a task at any depth; typed Bug or Feature, it reads by depth, as in a user repository.
- An issue typed Task and labelled `story` is a story.

The tests pin these three cases. `FakeProjects` gains an issue type per issue so the server tests can use them.

Sub-issues and blocked-by use the same mutations and limits for both owner types, and handoff's hierarchy and blockers live in the repository, so they need no change. The organization's other default issue fields (Start date, Target date, Effort) are not read (open question 3).

### 7. No webhook change

`projects_v2_item` deliveries exist only for organization Projects, through an organization webhook or an App. handoff's repository webhooks and `pnpm dev:webhooks owner/repo` do not get them. The Plan page keeps its 30 second refresh and the scheduler its checks (open question 6).

### 8. One fake, two owner types

`FakeProjects` gains `owners: Map<login, "User" | "Organization">` (default User), `canCreateProjects` per owner, Priority issue fields per organization with each issue's value, an issue type per issue, and `accessErrors` per owner login to throw `ProjectsAccessError`. Server, engine and worker tests run the same scenarios with an organization owner. The port's own tests answer through `fakeGraphql` with responses shaped like GitHub's, each document checked against the vendored schema as `octokit-projects.test.ts:883-888` does, and PR 3 replaces hand-written organization answers with recorded ones where it can.

### 9. Moving a project to an organization is a re-link, then a new plan

After a user transfers a repository to an organization, handoff still holds the old `repo_owner`. What breaks, from the code: every Project read uses the user's Project, whose items now belong to the organization's repository, so `toPlanItem` drops them all (`octokit-projects.ts:576`) and the plan looks empty; `issuePlan`'s owner match fails, so Status writes record `plan.skipped`; the scheduler finds no Ready task. Re-running `add_project` with the new name stops at the unique `repo_id` (when GitHub was configured at add time) with a database error, or, without GitHub, makes a second project.

The path:

1. **Re-link** with `handoff project move <project> --repo <org>/<name>` or Project settings, "Repository moved". It refuses while the project has active runs, as `deleteProject` does. It reads the repository's id from GitHub and refuses when `repo_id` is stored and differs ("Task-Insight/web is another repository than the one this project was added with"). It updates `repo_owner` and `repo_name`, rewrites the old prefix of each `runs.issues` URL so links do not lean on GitHub's redirect, sets `plan_project_number` to null when the plan's Project is not owned by the new owner, pauses the scheduler with "The repository moved to Task-Insight. Set up the plan again, then resume.", and returns the old plan's owner and number. Pins stay: they are keyed by issue number and hold place numbers, and a pin on a task outside the next plan is ignored as today.
2. **A new plan** with `setup_plan`. With `use`, it adopts an organization Project, such as one moved with the repository through "Move work to an organization". Without `use` it creates one. With `copy_from: { owner, number }` it then copies the old Project's items of this repository into the new Project: each item is added, gets its Status and the fields its plan mode uses (Size in Flow; Size, Estimate, Start and Target in Timeline), and the items end in the old Project order. A Priority value is not copied; the result lists the items that had one. The old Project stays as it is, for the person to close.
3. `add_project` with a repository whose id belongs to a project refuses with "Task-Insight/web is the project web, which knows it as Krister-Johansson/web. It moved: run handoff project move web --repo Task-Insight/web, or use Project settings, Repository moved."

The old user Project cannot be reused as the plan: per the docs a repository links only Projects of its own owner. The two ways to keep one Project object are GitHub's "Move work to an organization", which moves Projects too, or a copy; `copyProjectV2` copies fields and views but no items, so handoff's copy adds the items itself.

What else needs a person: install the GitHub App on the organization when handoff uses one (`getRepoInstallation` then finds it), re-run `pnpm dev:webhooks <org>/<name>`, and authorize the token for SSO if the organization requires it. Webhook deliveries and PR wake keys use `repo_id`, so they keep matching if the id survives the transfer (unverified). The worker clones the new remote into a new folder; the old clone stays under `HANDOFF_HOME/repos` until someone removes it.

## Design

### Data model

No migration. The owner type is read with every Project read; the re-link changes existing columns.

### Port

`packages/github/src/projects/types.ts`:

```ts
// PlanProject gains:
  /** Whether a user or an organization owns the Project. */
  owner?: "User" | "Organization" | undefined;
  /** Where priorityOptions and each item's priority come from; undefined without Priority. */
  prioritySource?: "project" | "issue-field" | undefined;

// ProjectsPort gains:
  /**
   * Adds the issues of `repo` that are items of the Project `from` to the Project `to`, writes each one's
   * Status and the given fields, and orders them as in `from`. 20 mutations a request.
   */
  copyItems(repo: RepoRef, from: { login: string; number: number }, to: { login: string; number: number }, fields: ("size" | "estimate" | "start" | "target")[]): Promise<{ copied: number[]; priorities: number[] }>;
```

The `login` parameters keep their name and meaning, the repository owner's login, and the doc comments drop "user". `packages/github/src/projects/access.ts` holds `ProjectsAccessError` and `accessErrorOf(error)`.

Queries: `plan-items.graphql`, `plan-project.graphql` (`PlanProjects`, `PlanProjectSetup`, `PlanProject`, and `PlanOwnerIds` through the repository), `issueFieldValues` and the Priority field's `isIssueField` (Decision 5), and `AddPlanItems` for `copyItems`, aliased like `moveItemsDocument`. Codegen regenerates `src/gql`.

### Server

- `apps/web/src/server/plan.ts`: sentences for both owner types; `loadPlan` turns `ProjectsAccessError` into `PlanUnavailable`.
- `apps/web/src/server/shaping.ts`: `setupPlan` gains `copyFrom`; refusals carry the access sentences.
- `apps/web/src/server/scheduler.ts`: the Priority refusal of Decision 5, and the source in `getScheduler`.
- `apps/web/src/server/project-admin.ts`: `moveProjectRepo(deps, projectId, repo)` (Decision 9).
- `apps/web/src/server/graphs.ts` and `agent-mcp.ts`: `add_project` refuses a repository id that belongs to a project.
- `apps/worker/src/cli.ts`: `handoff project move`.
- `apps/worker/src/plan-status.ts`: the start check's wording.

### Web

- Project settings, General: "Repository moved" opens a dialog with the new `owner/name`, says what changes ("handoff will use Task-Insight/web for this project's runs. The plan's GitHub Project belongs to Krister-Johansson, so it is unlinked; set up the plan again. The scheduler pauses.") and calls `moveProjectAction`.
- The Plan page's empty state (`components/plan/plan-empty.tsx:52`) shows the access sentence instead of "cannot reach your Projects".
- The scheduler card and settings name the Priority source.

### MCP tools and the plugin

- `list_github_projects`: "The GitHub Projects of the repository's owner, a user or an organization, that the token can write, those linked to the repository first ..." (`apps/web/src/lib/assistant/catalog.ts:480-491`).
- `setup_plan`: "a GitHub Project of the repository's owner" (`:492`), and `copy_from: { owner, number }` with the summary "and copy the items of Krister-Johansson's Project #5 with their Status and fields".
- `start_scheduler`'s description names the two Priority sources.
- `plugins/handoff/skills/handoff-setup/SKILL.md:94-104`: owner-neutral wording, the token sentence for organizations, SSO and the move path. `plugins/handoff/.claude-plugin/plugin.json` goes from `0.18.0` to the next minor version.

## Delivery

Each PR is one GitHub issue, one branch, CI green, one red-green slice per test named here, `pnpm doctor:react` clean after changes under `apps/web`, Context7 before code against Octokit, Drizzle, Zod, Vitest or Next.js, and `pnpm --filter @handoff/github codegen` after `.graphql` edits. PR 2 needs 1; 3 needs 1 and 2; 4 needs 1; 5 needs 3; 6 comes last.

1. **Port: Projects of either owner.** Files: `packages/github/src/queries/{plan-items,plan-project}.graphql`, the codegen output, `projects/{octokit-projects,types,kinds}.ts`, `testing/fake-projects.ts`. The existing tests in `octokit-projects.test.ts` change their answers from `user` to `repositoryOwner` with `__typename: "User"` and keep every assertion, which is the guard that user repositories answer as today. First tests: `octokit-projects.test.ts` additions "listItems reads an organization's Project through repositoryOwner and returns the repository's issues"; "a user's Project is still read in one request per page"; "getProject reads an organization's Project and says an organization owns it"; "listProjects lists the Projects the token can write for an organization repository, linked first"; "adoptProject links an organization Project to the organization's repository"; "createProject creates the Project under the repository's owner when it is an organization, and links it"; "createProject refuses before creating anything when the account cannot create Projects there"; "every plan document is valid against GitHub's schema". `kinds.test.ts` additions "an issue typed Task with the story label is a story"; "an issue typed Task without a kind label is a task at any depth"; "an issue typed Bug or Feature without a kind label takes its kind from depth". `fake-projects.test.ts` addition "an organization's Project is found by the organization's login, and listItems reads issue types".

2. **Access errors for organizations.** Files: `projects/access.ts`, `octokit-projects.ts` (the request wrapper), `apps/web/src/server/{plan,shaping,scheduler,readiness}.ts`, `components/plan/plan-empty.tsx`, `apps/worker/src/plan-status.ts`. First tests: `access.test.ts` "a missing scope names the scope GitHub asks for"; "a 403 with X-GitHub-SSO names the organization and the authorization URL"; "a 403 that says classic tokens are forbidden names the organization setting"; "other errors pass through unchanged". `octokit-projects.test.ts` addition "listItems on an organization that requires SSO throws a ProjectsAccessError with reason sso". `plan.integration.test.ts` addition "an organization Project the token is not authorized for shows the SSO sentence on the Plan page". `readiness.test.ts` addition "the plan check shows the access sentence for an organization". `packages/engine/src/plan-status.integration.test.ts` addition "a status write refused for SSO records plan.skipped with the sentence". `apps/worker/src/plan-status.test.ts` addition "a fine-grained token's log line says a user's Project needs a classic token and handoff uses one classic token for every Project".

3. **Organization plans through the tools, pages and scheduler.** Files: `apps/web/src/lib/assistant/catalog.ts`, `apps/web/src/server/{shaping,agent-mcp}.ts`, `plugins/handoff/skills/handoff-setup/SKILL.md`, `plugins/handoff/.claude-plugin/plugin.json`. First tests, each with `FakeProjects` and an organization owner: `shaping.integration.test.ts` additions "setup_plan in an organization repository creates the Project under the organization and links it"; "setup_plan with use adopts an organization Project"; "create_epic, create_story and create_task put the issues in Shaping on the organization's Project"; "plan_issue, move_to_ready and move_to_shaping write Status on the organization's Project"; "set_size writes Size on an organization Project in Flow mode and Size and Estimate in Timeline mode". `agent-mcp.integration.test.ts` additions "list_github_projects lists the organization's Projects for an organization repository"; "arrange_plan in a Flow project reads an organization's plan"; "set_order moves a task in an organization's Project order". `flow-order.integration.test.ts` addition "writeOrder moves a task in an organization's Project order and pins it". `plan.integration.test.ts` addition "loadPlan reads an organization's plan in Flow and in Timeline mode". `tick.integration.test.ts` addition "the scheduler starts a Ready task of an organization's plan in Project order". `packages/engine/src/plan-status.integration.test.ts` addition "a run writes Running, In review and Done on an organization's Project". `catalog.test.ts` addition "list_github_projects and setup_plan describe the repository owner's Projects, a user's or an organization's". `packages/connector/src/plugin.test.ts` additions for the setup skill's text and the version. Manual step recorded on the PR (Verification, steps 1 to 6).

4. **Priority from the organization's issue field.** Files: `plan-items.graphql`, `plan-project.graphql`, codegen output, `octokit-projects.ts`, `types.ts`, `fake-projects.ts`, `apps/web/src/server/scheduler.ts`, `server/scheduler-card.ts`, `components/scheduler/*`, `catalog.ts` (`start_scheduler`). First tests: `octokit-projects.test.ts` additions "in an organization whose Project has no Priority field, listItems reads each issue's Priority issue field and getProject returns its options in priority order"; "a Project's own Priority field wins over the organization's issue field"; "a Priority column backed by the issue field reads the issue's value"; "a user's Project reads Priority as before and has no issue field source". `scheduler.integration.test.ts` additions "start_scheduler with priority order in an organization repository accepts the Priority issue field when the Project has none"; "start_scheduler refuses priority order with neither and names both". `tick.integration.test.ts` addition "priority order from the issue field starts an Urgent task before a High one". `scheduler-card.test.ts` addition "the card says which Priority orders the tasks". Manual step recorded on the PR: the `rateLimit { cost }` of `PlanItems` with `issueFieldValues` on a page of 100 items, and how a Project that shows the Priority issue field answers `field(name: "Priority")` and `fieldValueByName`.

5. **Moving a project to an organization.** Files: `apps/web/src/server/{project-admin,graphs,agent-mcp,shaping}.ts`, `apps/worker/src/cli.ts`, the project settings page, `components/projects/repository-moved.tsx`, `app/projects/actions.ts` (`moveProjectAction`), `catalog.ts` (`setup_plan`'s `copy_from`), `packages/github/src/queries/plan-mutations.graphql` (`AddPlanItem` aliased), `octokit-projects.ts` and `fake-projects.ts` (`copyItems`). First tests: `project-admin.integration.test.ts` additions "moving a project to its repository's new owner keeps runs, graphs, pins and the scheduler row, rewrites the runs' issue URLs and forgets the plan's Project number"; "moving pauses the scheduler with the reason"; "moving refuses while a run is active"; "moving refuses a repository with another id". `agent-mcp.integration.test.ts` addition "add_project for a repository that is already a project under its old name names the project and the move command". `apps/worker/src/cli.integration.test.ts` addition "project move changes the repository of a project". `shaping.integration.test.ts` addition "setup_plan with copy_from copies each item's Status and the mode's fields into the new Project in the old Project order, and lists the items with a Priority". `octokit-projects.test.ts` additions "copyItems adds 20 items per request and orders them as the source"; "copyItems skips items of other repositories". Web: `repository-moved.test.tsx` "the dialog says the plan is unlinked and the scheduler pauses, and Save moves the project". Manual step recorded on the PR (Verification, step 7).

6. **Docs.** `README.md` (The token: organizations, SSO, blocked classic tokens; Linking a Project: either owner; a new "Moving a repository to an organization"), ADR 0007 (Projects of either owner, the Priority rule, the token rule, the webhooks line), `GLOSSARY.md` (Priority, with its two sources), `docs/plans/scheduler.md` and `docs/plans/project-management.md` (a note that organizations are covered here, with a link). Close #575.

## Risks

| Risk | Mitigation |
|---|---|
| The query change breaks user repositories | The existing tests keep their assertions and change only the answer's shape; PR 3's manual step runs a user project too. |
| GitHub's real error bodies differ from the test fixtures | Matching goes by header first, then `type`, then message; PR 3 records real bodies and updates the fixtures; an unknown error passes through with GitHub's own message. |
| `read:org` turns out to be needed | PR 3's manual step uses a token without it; if the call fails, PR 3 adds the scope check for organization owners. |
| The default Priority issue field makes every task unprioritized | The Project's own field wins (Decision 5); the issue field is used only without one, and the card names the source. |
| Reading `issueFieldValues` on 100 items costs points on every Plan page refresh | PR 4 measures it; if it adds points, the field is read only when the Project has no Priority field of its own, with a second request. |
| A Project shows two fields named Priority | Decision 5 picks the Project's own field; PR 4's manual step records how GitHub names the issue field's column. |
| An organization repository has issues typed Task at the top level | Without a kind label they read as tasks; the shaping tools always set labels, and `list_plan` shows the kind. |
| A transfer leaves the plan looking empty with no explanation | `add_project` and the Plan page's empty state name the move; the move pauses the scheduler. |
| The repository id changes on transfer | The move then refuses and says the ids differ. PR 5's manual step records the ids first; if they change, PR 5 drops the id check and the dialog asks the person to confirm the move instead. |
| Copying a large plan trips the secondary rate limit | 20 mutations per request with Octokit's one second spacing, as `setManyPlanFields` and `moveItems` do. |
| An organization blocks classic tokens | The sentence says so and names the setting; fine-grained tokens and the App path are open questions 4 and 5. |

## Open questions

Each has a recommended answer; unanswered, the implementation takes the recommendation.

1. When a Project has its own Priority field and the organization has the Priority issue field, which orders the scheduler? Recommended: the Project's own field (Decision 5).
2. Should `setup_plan` add the organization's Priority issue field to a new organization Project as a column? Recommended: no. Reading does not need it, and a person adds it in one click if they want to see it.
3. Should a Timeline project in an organization use the organization's Start date, Target date and Effort issue fields instead of the Project's Start, Target and Size? Recommended: no. One set of fields for both owner types keeps one code path, and Effort's High, Medium and Low are not handoff's S, M and L.
4. Should handoff accept a fine-grained token for an organization-only setup? Recommended: not in this plan. A fine-grained token has one resource owner and cannot reach a user's Project, while `GITHUB_TOKEN` serves every project.
5. Should the Projects port use the GitHub App for organization repositories? Recommended: not in this plan; a follow-up issue. It needs the App's organization permission "Projects" and repository permission "Issues" read and write, an installation token per organization in the port, and a second access path in every check.
6. Should `projects_v2_item` webhooks wake the scheduler and refresh the Plan page for organization Projects? Recommended: not now. They need an organization webhook or the App, and the 30 second refresh works for both owner types.
7. Should the re-link be an MCP tool too? Recommended: no. A person moves a repository; the CLI and Project settings cover it, and `add_project` points to them.
8. Should `copy_from` copy Priority values into the organization's issue field? Recommended: no. Option names may differ and the write changes the issues themselves; the result lists the items to look at.
9. Should handoff store the owner type on the project? Recommended: no. It comes with every Project read and changes with a transfer.
10. Which organization does the manual check use? Recommended: a new organization the user creates for tests, with one throwaway repository. `Task-Insight` is an organization the user administers with five real repositories, so tests should not create Projects or issues there.
11. Should `list_github_projects` list only Projects the token can write? Recommended: yes (Decision 1).

## Verification

Tests and checks:

```bash
pnpm db:migrate        # in the main checkout; never pnpm db:up in a worktree
pnpm --filter @handoff/github codegen
pnpm test
pnpm typecheck && pnpm lint
pnpm doctor:react
```

By hand, on the PR that implements PR 3 and later as noted. The user creates these first, since agents must not create GitHub organizations: a test organization (a free organization is enough), and in it one throwaway repository with a commit on its default branch. For step 7, also a throwaway repository under the user's account with a small plan. Run `pnpm dev:web` and `pnpm dev:worker`, the worker from a separate worktree.

1. With a classic token that has `repo` and `project` and not `read:org` (the user makes it), call `list_github_projects` on a project for the test repository: expect the organization's Projects, or none. Record the request and its answer on the PR.
2. `add_project <test-org>/<repo>`, then `setup_plan`. Expect a Project "<name> plan" owned by the organization, linked to the repository, with Shaping, Ready, Running, In review and Done and the Size field, and the labels `epic`, `story` and `task` on the repository. Check with `gh project list --owner <test-org>`.
3. `create_epic`, `create_story` and `create_task`, then `move_to_ready`. Expect the issues on the organization Project with labels, sub-issues and Status. Set one issue's type to Task and give an epic the type Task: expect `list_plan` to keep the epic an epic.
4. Start one run on the Ready task, by hand or with `start_scheduler` in Project order. Expect Running on the item at start, In review when the pull request opens and Done after the merge.
5. Repeat step 2 on a user-owned throwaway project and compare: the same result as before this change.
6. Record the GraphQL error bodies GitHub sends for a token without `project`, and, if the test organization's owner turns on "Restrict access via personal access tokens (classic)" for a minute, for a blocked classic token. Turn it off again.
7. (PR 5) Transfer the user's throwaway repository to the test organization. Record `gh api repos/<org>/<repo> --jq .id` and the node id before and after, whether its issues are still items of the old user Project, and whether `repository(owner: "<user>", name:)` still answers. Run `handoff project move`, then `setup_plan` with `copy_from`: expect the items in the new organization Project in the same order with their Status and fields, and the Plan page showing them.
