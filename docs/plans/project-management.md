# Project management on GitHub Projects

## Context

handoff turns GitHub issues into pull requests. A project is a repository, its backlog is the open issues no run works on yet (`apps/web/src/server/backlog.ts`, the `list_backlog` tool in `apps/web/src/server/agent-mcp.ts`), and a run links one or more issues whose bodies the agents read (`LinkedIssueSchema` in `packages/core/src/schema/run-state.ts`, rendered under "Linked issues" by `packages/core/src/context/render.ts`). The Issues tab shows that flat list, with "Link dependencies" turning "Depends on: #n" lines into GitHub's own blocked-by links.

The user's problem: the Issues tab shows tasks, but not what each task is part of. Shaping happens outside handoff, and there is no place to see an epic's progress or to hold tasks back until they are ready to build. The user wants a project management view: epics, stories and tasks, a board with the status of each, shaping with Claude Code first, and tasks released to the issue queue when a feature is shaped.

The user decided that GitHub is the source of truth. handoff stores no plan of its own. It reads the hierarchy and the status from GitHub and writes status back as runs progress.

This plan follows `docs/plans/assistant-webmcp.md` and `docs/plans/voice.md` in form. It is written for a fresh session. Read `CLAUDE.md`, `GLOSSARY.md`, `docs/plan.md`, `docs/adr/0005-pnpm-workspace-layout.md`, `docs/plans/assistant-webmcp.md` (the tool catalog and approval cards this plan extends) and `docs/plans/stacked-prs.md` (the other plan that touches `LinkedIssue` and the PR node) first.

## Goals

- A hierarchy of epic, story and task on GitHub, as sub-issues in the project's repository, with a kind label on each issue.
- A status per task on a GitHub Project (v2) owned by the user, with the columns Shaping, Ready, Running, In review and Done.
- Shaping through handoff's tool catalog: the dashboard assistant and the Claude Code plugin create epics, stories and tasks in Shaping, with an approval card for every write to GitHub.
- Ready is the gate: only tasks in Ready, not blocked by an open issue and without an active run, enter the backlog and `list_backlog`. Epics and stories never run.
- handoff moves a task's status as its run progresses: Running when a run starts, In review when the pull request opens, Done when it merges, back to Ready when the run is cancelled.
- A Plan tab per project with a tree (epic, story, task, with progress rolled up) and a board (one column per status), filters, and links from a task to its run, to the inbox and to GitHub.
- When a run starts on a task, the agents also read the parent story and epic.
- A timeline (Gantt) view on the Plan page: planned bars from Start and Target dates held on the GitHub Project, the actual time each task's runs took next to them, dependency arrows from blocked-by links, and late or blocked items flagged, so a project manager sees what cannot start until something else is done.
- handoff stores nothing about the plan except which GitHub Project belongs to a handoff project.

## Non-goals

- A plan store, a cache table, or any copy of issues, statuses or hierarchy in Postgres.
- Drag and drop on the dashboard's board. GitHub's own board does that; the dashboard's board is a view with buttons for the two moves handoff owns (to Ready, back to Shaping).
- Organization-owned Projects, issue types, or a GitHub App path to Projects. The user's account is a personal account (see Verified facts); the design covers what a personal account can do. Organization support is listed under Risks as the upgrade path.
- Iterations, estimates, priorities, milestones or custom fields beyond Status, Start and Target. The Project may have them; handoff ignores them. Automatic scheduling from estimates and dependency order is recorded as a later step in Decision 8, not built.
- Dragging bars on the dashboard's timeline. GitHub's roadmap drags dates; the dashboard's timeline schedules through a dialog behind a confirmation (Decision 8, open question 10).
- Running epics or stories. A run works on tasks. Splitting a task into a stack of pull requests stays in `docs/plans/stacked-prs.md`.
- Webhooks for Project changes. They do not exist for user-owned Projects (Verified facts); the dashboard polls.
- Multi-user use. One person, one machine, one token, as today.

## Verified facts

Checked on 2026-10-02 against the pages named and against the user's account with read-only `gh` calls. Re-verify before coding against any of them.

### The account, live

- `gh api user`: login `Krister-Johansson`, type `User`. The token `gh auth token --user Krister-Johansson` returns is a classic OAuth token; `gh api -i user` shows `X-Oauth-Scopes: admin:public_key, gist, project, read:org, repo, workflow`. The `project` scope is already present, so the dashboard's `GITHUB_TOKEN` (the user sets it from `gh auth token`) can read and write user-owned Projects today.
- Installed: gh 2.101.0 (2026-09-15), extensions `cli/gh-webhook` v0.2.0 and `github/gh-stack` v0.1.1. `gh issue create --help` lists `--parent`, `--type`, `--blocked-by`, `--blocking`; `gh issue edit --help` lists `--parent`, `--remove-parent`, `--add-blocked-by`, `--remove-blocked-by`, `--add-blocking`, `--remove-blocking`, `--type`, `--remove-type`; `gh issue list --json` offers `parent`, `blockedBy`, `blocking`, `issueType`, `projectItems`.
- GraphQL on `repository(owner: "Krister-Johansson", name: "handoff")`: `owner.__typename` is `User`, `issueTypes` is `null`. On issue #300: `issueType` is `null`, `parent` is `null`, `subIssues.totalCount` 0, `subIssuesSummary { total 0, completed 0, percentCompleted 0 }`, `blockedBy.totalCount` 0, `blocking.totalCount` 0, `projectItems.totalCount` 0. The fields resolve without error, so sub-issues and dependencies work on this repository; no issue in handoff uses them yet (a search of all 165 issues found none with a parent, sub-issues, blockers or a type).
- REST `GET /repos/Krister-Johansson/handoff/issues/300` returns `type: null`, `sub_issues_summary { total, completed, percent_completed }` and `issue_dependencies_summary { blocked_by, blocking, total_blocked_by, total_blocking }`.
- `viewer.projectsV2` lists three user-owned Projects: `gqlPrune Roadmap` (number 3, 58 items, linked to repository `Krister-Johansson/gqlPrune`), `Ostiarum Roadmap` (number 2, 14 items) and `@Krister-Johansson's untitled project` (number 1, 1 item). Every one has the built-in fields `Title`, `Assignees`, `Status` (single select), `Labels`, `Linked pull requests`, `Milestone`, `Repository`, `Reviewers`, `Parent issue` (data type `PARENT_ISSUE`), `Sub-issues progress` (`SUB_ISSUES_PROGRESS`), `Created`, `Updated`, `Closed`. Status options on numbers 2 and 3 are `Todo`, `In Progress`, `Done`; number 1 has `New`, `Backlog`, `Ready`, `In progress`, `In review`, `Done` with emoji prefixes, which shows Status options are renamable on a user Project.
- Workflows (`projectV2.workflows`): number 1 has `Item closed` and `Pull request merged`, both enabled. Number 3 has `Auto-add sub-issues to project`, `Auto-close issue`, `Item added to project`, `Item closed`, `Pull request linked to issue` and `Pull request merged`, all enabled.
- REST `GET /users/Krister-Johansson/projectsV2` returns 200 with the same three Projects; `/users/Krister-Johansson/projectsV2/3/fields` returns the fields with integer ids; `/users/Krister-Johansson/projectsV2/3/items?per_page=2` returns items whose `fields` array holds only `Title` unless more fields are asked for.
- Cost: one GraphQL call reading Project 3's 58 items with `fieldValues(first: 20)` and each item's issue (`parent`, `subIssuesSummary`, `issueType`, repository) reported `rateLimit { cost: 1, remaining: 4868, limit: 5000 }`.
- Schema introspection (live): `ProjectV2FieldType` includes `ISSUE_TYPE`, `PARENT_ISSUE`, `SUB_ISSUES_PROGRESS`, `TRACKS`, `TRACKED_BY`; `ProjectV2CustomFieldType` is `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT`, `NUMBER`, `DATE`, `ITERATION`. `CreateIssueInput` has `parentIssueId` ("The Node ID of the parent issue to add this new issue to"), `issueTypeId`, `projectV2Ids` and `issueFields`. `ProjectV2` has `workflows`; the only workflow mutation is `deleteProjectV2Workflow`. `UpdateProjectV2ItemFieldValueInput` is `projectId`, `itemId`, `fieldId`, `value`.
- The pinned `@octokit/graphql-schema` 15.26.1 (also the latest on npm, modified 2026-07-24) has `subIssuesSummary`, `addSubIssue`, `parentIssueId`, `updateProjectV2ItemFieldValue`, `linkProjectV2ToRepository` and `SUB_ISSUES_PROGRESS`, but not `blockedBy`, `issueDependenciesSummary`, `addBlockedBy`, `issueType` or `ISSUE_TYPE`. GitHub's published schema at https://docs.github.com/public/fpt/schema.docs.graphql (1.56 MB) has all of them.

### Sub-issues

- REST (https://docs.github.com/en/rest/issues/sub-issues): `GET .../issues/{n}/parent`, `GET .../issues/{n}/sub_issues`, `POST .../issues/{n}/sub_issues` with `sub_issue_id` (required) and `replace_parent`, `DELETE .../issues/{n}/sub_issue` with `sub_issue_id`, `PATCH .../issues/{n}/sub_issues/priority` with `sub_issue_id` and `after_id` or `before_id`. Permission: repository "Issues" read for reads, write for writes. Constraint: "The sub-issue must belong to the same repository owner as the parent issue".
- GraphQL (schema at https://docs.github.com/public/fpt/schema.docs.graphql, reference https://docs.github.com/en/graphql/reference/issues): `Issue.parent`, `Issue.subIssues`, `Issue.subIssuesSummary { total, completed, percentCompleted }`; mutations `addSubIssue(issueId, subIssueId | subIssueUrl, replaceParent)`, `removeSubIssue(issueId, subIssueId)`, `reprioritizeSubIssue(issueId, subIssueId, afterId | beforeId)`; `createIssue(parentIssueId)`.
- Limits (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues): "You can add up to 100 sub-issues per parent issue and create up to eight levels of nested sub-issues." Permission: "at least triage permissions".
- Availability: the 2025-01-13 changelog (https://github.blog/changelog/2025-01-13-evolving-github-issues-public-preview/) released "sub-issues, issue types and advanced search for issues to everyone"; GA on 2025-04-09 (https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/). The live check above confirms the fields on a personal repository.
- Project inheritance (https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/): "Sub-issues now inherit the Project and Milestone of their parent issue by default."
- Webhook `sub_issues` (https://docs.github.com/en/webhooks/webhook-events-and-payloads#sub_issues): availability Repositories, Organizations, GitHub Apps; actions `parent_issue_added`, `parent_issue_removed`, `sub_issue_added`, `sub_issue_removed`; payload `parent_issue_id`, `parent_issue`, `parent_issue_repo`, `sub_issue_id`, `sub_issue`.
- gh CLI (https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/): "Anyone on GitHub CLI v2.94.0 or later can use the new hierarchy and dependency support."

### Issue dependencies

- REST (https://docs.github.com/en/rest/issues/issue-dependencies): `GET .../issues/{n}/dependencies/blocked_by`, `POST .../issues/{n}/dependencies/blocked_by` with `issue_id` ("The id of the issue that blocks the current issue"), `DELETE .../issues/{n}/dependencies/blocked_by/{issue_id}`, `GET .../issues/{n}/dependencies/blocking`. Only the blocked-by side is writable. handoff's `addBlockedBy` in `packages/github/src/octokit-client.ts` already uses the POST.
- GraphQL: `Issue.blockedBy`, `Issue.blocking`, `Issue.issueDependenciesSummary { blockedBy, blocking, totalBlockedBy, totalBlocking }`; mutations `addBlockedBy(issueId, blockingIssueId)` and `removeBlockedBy`. There is no `blockedByCount` field.
- Limits and plans (https://github.blog/changelog/2025-08-21-dependencies-on-issues/ and https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies): "You can link up to 50 issues for each relationship type." and "Issue dependencies are available for users on GitHub Free, GitHub Pro, GitHub Team, and GitHub Enterprise Cloud plans."
- Effect: "Blocked issues are marked with a "Blocked" icon on your project boards or repository's Issues page" (same docs page). No page describes any automatic behaviour beyond display and the `is:blocked`, `blocked-by:`, `blocking:` filters.
- Webhook `issue_dependencies`: availability Repositories, Organizations, GitHub Apps; actions `blocked_by_added`, `blocked_by_removed`, `blocking_added`, `blocking_removed`.

### Issue types

- Configured per organization (https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization): "Organization owners can modify issue types.", "You can create up to 25 issue types that your organization members can apply to issues", defaults "task, bug, and feature".
- The REST endpoints all live under `/orgs/{org}/issue-types` (https://docs.github.com/en/rest/orgs/issue-types) with the organization permission "Issue Types"; there is no `/users/` equivalent. The gh CLI changelog says "Issue types are configured at the organization level, so type support applies to issues in organizations that have defined them."
- GraphQL: `Issue.issueType`, `Repository.issueTypes`, `Organization.issueTypes`, `createIssueType(ownerId: "the organization", ...)`, `updateIssueIssueType(issueId, issueTypeId)`, `createIssue(issueTypeId)`. REST `type` on create and update: "Only users with push access can set the type for new issues. The type is silently dropped otherwise."
- Live: `repository.issueTypes` is `null` on the user's repository. Conclusion: issue types are not available to this account. The hierarchy's kinds need another marker (Decision 1).

### Projects v2

- API guide: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects. A user Project's node id: `user(login:) { projectV2(number:) { id } }`. `createProjectV2(ownerId, title, repositoryId?)` where `ownerId` is "the node ID of a GitHub user or organization who will become the project's owner". Fields through `fields(first: 20)` with `ProjectV2Field`, `ProjectV2IterationField`, `ProjectV2SingleSelectField { options { id name } }`. Items: `addProjectV2ItemById(projectId, contentId) { item { id } }`, `addProjectV2DraftIssue`, `deleteProjectV2Item`. Reading: `items(first:) { nodes { id fieldValues(first:) { ... } content { ... on Issue } } }`. Writing: `updateProjectV2ItemFieldValue(projectId, itemId, fieldId, value: { singleSelectOptionId | text | number | date | iterationId })`. "You cannot use `updateProjectV2ItemFieldValue` to change `Assignees`, `Labels`, `Milestone`, or `Repository`"; Status is a single select field and is not in that list.
- Fields reference (https://docs.github.com/en/graphql/reference/projects): `createProjectV2Field(projectId, name, dataType, singleSelectOptions)`, `updateProjectV2Field(fieldId, ...)` with "Options for a single select field. At least one value is required if data_type is SINGLE_SELECT."; `linkProjectV2ToRepository(projectId, repositoryId)`; `ProjectV2.workflows` with `ProjectV2Workflow { enabled, name, number }`; no mutation creates or edits a workflow.
- Linking (https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository): "You can only list projects that are owned by the same user or organization that owns the repository."
- Limits: "Values of first and last must be within 1-100. Individual calls cannot request more than 500,000 total nodes." (https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api). "A project can contain a maximum of 50,000 items across both active views and the archive page." (https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/archiving-items-from-your-project). "You can use up to 50 fields in a project" (about projects page). "Single select fields can contain up to 50 options." (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields).
- Status field: the quickstart (https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/quickstart-for-projects) says "The board layout is based on the status field by default"; the board page says moving a card to a column changes its Status. Default options observed live: `Todo`, `In Progress`, `Done`.
- Parent issue and sub-issue progress fields (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields): both are hidden fields a person can show; "The 'Parent issue' field can be used to group items". A hierarchy view is in public preview since 2026-01-15 (https://github.blog/changelog/2026-01-15-hierarchy-view-now-available-in-github-projects/). The `Type` field (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-the-issue-type-field) exists "if your organization uses issue types".
- Built-in workflows (https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations): "When your project initializes, two workflows are enabled by default: When issues or pull requests in your project are closed, their status is set to Done, and when pull requests in your project are merged, their status is set to Done." The "Item added to project" workflow sets Status to Todo when turned on. Auto-add (https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically): "The auto-add workflow is limited per plan", GitHub Free 1, Pro 5, Team 5, Enterprise Cloud 20. Auto-close issue (https://github.blog/changelog/2024-04-25-github-issues-projects-auto-close-issue-project-workflow/): issues close "when their project status is changed to 'Done' or any custom status you define".
- REST for Projects v2 (https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/, reference https://docs.github.com/en/rest/projects): `GET /users/{username}/projectsV2`, `GET /users/{username}/projectsV2/{number}`, `/items` (GET, POST, PATCH with `fields: [{ id, value }]`), `/fields` (GET, POST). The reference pages carry no preview callout.

### Dates, iterations and the roadmap layout

Checked on 2026-10-02.

- Custom field types (live introspection of `ProjectV2CustomFieldType`, and https://docs.github.com/en/graphql/reference/projects): `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT`, `NUMBER`, `DATE`, `ITERATION`. `createProjectV2Field(projectId, dataType, name, singleSelectOptions?, multiSelectOptions?, iterationConfiguration?)`; `iterationConfiguration` is "Configuration for an iteration field." with `startDate` ("The start date for the first iteration."), `duration` ("The duration of each iteration, in days.") and `iterations` ("Zero or more iterations for the field.").
- Writing a date or an iteration (same reference, live introspection of `ProjectV2FieldValue`): `updateProjectV2ItemFieldValue(projectId, itemId, fieldId, value: { date })` where `date` is "The ISO 8601 date to set on the field."; `value: { iterationId }` is "The id of the iteration to set on the field." `clearProjectV2ItemFieldValue(projectId, itemId, fieldId)` exists (live mutation list).
- Reading (same reference, live introspection): `ProjectV2ItemFieldDateValue { date, field, ... }` with `date` "Date value for the field."; `ProjectV2ItemFieldIterationValue { iterationId, startDate, duration, title, ... }` with `duration` "The duration of the iteration in days."; `ProjectV2IterationField.configuration { duration, startDay, iterations, completedIterations }` and `ProjectV2IterationFieldIteration { id, startDate, duration, title }`.
- Date fields (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-date-fields): added through "Add field", "New field", "Select Date"; filters use "the `YYYY-MM-DD` format"; "Date fields do not currently support default values." The page does not mention the API.
- Iteration fields (https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-iteration-fields): "You can create an iteration field to associate items with specific repeating blocks of time."; "Iterations can be set to any length of time, can include breaks, and can be individually edited to modify name and date range."; "When you first create an iteration field, three iterations are automatically created."
- Roadmap layout (https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout and https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view): "Roadmaps use your custom date and iteration fields to position your issues, pull requests, and draft issues on a timeline"; the start and target come from "Click Date fields. Select a date or iteration field for 'Start date' and 'Target date.'"; zoom is "Month, Quarter, or Year"; vertical markers "including iterations, milestones, and the dates of items"; the layout "allows you to drag items to affect their start and target dates or selected iteration". Neither page mentions sub-issues, dependencies or a limit on items or views.
- Views through the API (live introspection): `ProjectV2ViewLayout` is `BOARD_LAYOUT`, `TABLE_LAYOUT`, `ROADMAP_LAYOUT`; `createProjectV2View(projectId, name, layout, configuration)` exists; `ProjectV2View` exposes `layout`, `filter`, `fields`, `groupByFields`, `sortByFields`, `verticalGroupByFields` and `configuration`, with no field naming the roadmap's start or target date fields.
- Live, the user's Projects: none of the three has a `DATE` or `ITERATION` field (the custom fields are the single selects Priority and Size). Views: Project 3 has one table view, Project 2 one board view, Project 1 two table views and one board view; none is a roadmap.
- Run timing in handoff: `runs.startedAt` and `runs.finishedAt` (`packages/db/src/schema/runs.ts`), and `node_executions.startedAt` and `finishedAt`, are the actual times a run and its steps took.

### Authentication

- Classic tokens (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps): `project` "Grants read/write access to user and organization projects."; `read:project` "Grants read only access to user and organization projects." The API guide: "a token that has the read:project scope (for queries) or project scope (for queries and mutations)".
- Fine-grained personal access tokens (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens, "Fine-grained personal access tokens limitations"): "Using fine-grained personal access token to access Projects owned by a user account." is a listed gap. The permissions page (https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) has "Projects" only under organization permissions, all endpoints `/orgs/{org}/projectsV2/...`.
- GitHub Apps (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps): "Projects" exists only under organization permissions. No repository or account permission covers `/users/{username}/projectsV2`. The webhook docs say a GitHub App subscribing to project events needs "read-level access for the "Projects" organization permission". Conclusion: handoff's GitHub App path (`OctokitGitHub.withApp` in `packages/github/src/octokit-client.ts`) cannot reach a user-owned Project.
- Sub-issues, dependencies and labels need repository "Issues" write, which `repo` grants on a classic token and which the App already has.
- gh (https://cli.github.com/manual/gh_auth_login, https://cli.github.com/manual/gh_project, https://cli.github.com/manual/gh_auth_refresh): login's minimum scopes are "repo, read:org, and gist"; `gh project` says "The minimum required scope for the token is: project." and "add the project scope by running gh auth refresh -s project."

### Webhooks

- `projects_v2`, `projects_v2_item`, `projects_v2_status_update` (https://docs.github.com/en/webhooks/webhook-events-and-payloads): availability "Organizations" only; each "occurs when there is activity relating to an item on an organization-level project"; "Webhook events for projects are currently in public preview and subject to change." `projects_v2_item` actions: archived, converted, created, deleted, edited, reordered, restored; `changes.field_value { field_node_id, field_type, field_name, project_number, from, to }`.
- User accounts (https://docs.github.com/en/webhooks/types-of-webhooks): "You cannot create webhooks for individual user accounts, or for events that are specific to user resources". So no webhook reports a status change on a user-owned Project.
- `issues` event: availability Repositories, Organizations, GitHub Apps; actions include `opened`, `edited`, `closed`, `reopened`, `labeled`, `unlabeled`, `typed`, `untyped`; the payload's `issue` carries `type`, `sub_issues_summary` and `issue_dependencies_summary` (GitHub's OpenAPI description, `x-webhooks`).
- `gh webhook forward` (https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/using-the-github-cli-to-forward-webhooks-for-testing, source https://raw.githubusercontent.com/cli/gh-webhook/main/webhook/forward.go): flags `--events` (required, `*` for all), `--repo`, `--org`, `--url`, `--secret`, `--github-host`; "`--repo` or `--org` flag required"; "only designed for use during testing and development"; "Only one person can use webhook forwarding at a time for each repository and organization." handoff's `scripts/forward-webhooks.sh` forwards `check_suite, check_run, workflow_run, pull_request, pull_request_review, pull_request_review_comment, issue_comment` for one repository.

### Rate limits

- https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api: "5,000 points per hour per user"; cost is the sum of requests per unique connection assuming every `first` is reached, "Divide the number by 100 and round the result to the nearest whole number", minimum 1; secondary limits "No more than 100 concurrent requests", "no more than 2,000 points per minute are allowed for the GraphQL API endpoint", 900 points per minute for REST, "No more than 80 content-generating requests per minute". `rateLimit { limit cost remaining used resetAt }` reports the cost.
- Applied: one page of `items(first: 100) { fieldValues(first: 20) content { ... } }` is 1 (project) + 1 (items) + 100 (field values) = 102 requests, 1 point. A 200-item board is two calls, 2 points. The live measurement (1 point for 58 items) agrees. Polling every 30 seconds while the Plan tab is open costs at most 240 points per hour of the 5,000.

### The codebase

- `packages/github`: `GitHubPort` (`types.ts`) with `listIssues` (GraphQL, first 100 open issues with labels and `blockedBy`, validated with Zod at runtime because the pinned schema lacks `blockedBy`), `getIssue`, `openBlockers`, `addBlockedBy` (REST), `closeIssue`, PR methods; `OctokitGitHub` with `withToken` and `withApp`; `gitHubFromEnv` prefers the App when `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` are set, else `GITHUB_TOKEN`; `FakeGitHub` in `testing/fake-github.ts` with an `issues` map; codegen from `src/queries/*.graphql` against `node_modules/@octokit/graphql-schema/schema.graphql` into `src/gql/`; adapter tests use a `fakeFetch` router over `POST /graphql` and REST paths (`octokit-client.test.ts`).
- `apps/web/src/server/backlog.ts`: `listBacklog(db, github, projectId)` returns open issues with the latest run per issue; `isTodo` is "no run, or the run is cancelled"; startable issues (no open blocker) come first. `listBacklogOnce` caches per request.
- `apps/web/src/server/graphs.ts`: `startRunFromGraph(db, { projectId, graphName, task, issues }, github)` fetches each issue (`linkIssues`), `refuseBlocked` throws when a blocker is open, the task defaults to the issue titles, `createRun` stores `issues` on the run and in run state.
- `packages/engine/src/context.ts` puts `state.issues` into the context packet; `packages/core/src/context/render.ts` renders "# Linked issues" with each body; `criteriaInIssue` reads acceptance checkboxes.
- `packages/engine/src/executors/github.ts`: the PR node writes `Closes #n` for each linked issue, emits `github.pr` with the number, and after the merge `closeLinkedIssues` comments and closes each issue (GitHub does not always honour `Closes`). `packages/engine/src/operations.ts` has `cancelRun` (event `run.cancelled`); `scheduler/worker.ts` emits `run.started`.
- `apps/web/src/server/github-webhook.ts` verifies the signature, stores every delivery in `webhook_deliveries` (any event name), correlates PR events and wakes executions. Issue events are stored but unused.
- `apps/web/src/lib/assistant/catalog.ts` is the single tool catalog (`ToolSpec` with `kind`, `confirm`, `readOnly`, `untrusted`, `summarize`); `agent-mcp.ts` registers its data tools for the plugin, the assistant and WebMCP; confirm tools show an approval card in the assistant. `readiness.ts` lists setup checks (`acceptance`, `dependencies`, `webhooks`, ...). `link-dependencies.ts` and `lib/depends-on.ts` parse "Depends on" lines.
- `plugins/handoff`: the Claude Code plugin with the MCP server (`server/handoff-mcp.mjs`, user config `url` and `token`, a channel) and the skills `handoff` (plan work as issues with `gh issue create`, then `list_backlog`, `start_run`, `get_run`) and `handoff-setup` (setup items, including "Issue dependencies" through "Depends on" lines).
- Project page: `apps/web/src/app/projects/[projectId]/page.tsx` renders one tab from `?tab=` (`PROJECT_TABS = runs, issues, pulls, graphs, settings` in `lib/project-tab.ts`); the Issues tab is `components/projects/backlog.tsx` with filters `?issues=todo|started|all`, `StartRunDialog`, `BlockedRunButton` and `LinkDependenciesButton`. Paths in `lib/paths.ts`; the inbox narrows with `?project=<id>`.
- `packages/db/src/schema/projects.ts`: `projects` has `repoId`, `repoOwner`, `repoName`, `defaultBranch`, `isDemo`, `library`, `setupCommand`; no plan columns. `runs.issues` is `{ number, title, url }[]`; bodies live in run state.

## Unverified

- Whether a Project created with `createProjectV2` for a user gets the "Item added to project" workflow, and whether it is enabled. Project 1 (older) has two workflows, Project 3 has six including it. If enabled, it sets a Status option on add and could race handoff's own write of Shaping. PR 1's manual step creates a throwaway Project and records its `workflows`; handoff writes Shaping after every add regardless.
- Whether the default workflows "Item closed" and "Pull request merged" keep working after handoff renames the Status options. The plan keeps an option named `Done` and renames the others, which no page covers. PR 1's manual step closes a test issue and checks the column.
- Whether `createIssue(parentIssueId)` adds the new issue to the parent's Project (the changelog says sub-issues inherit the Project "by default", in the context of the web UI). The port reads `projectItems` after creating and adds the item when it is missing, so the answer only changes a call count.
- Whether `addProjectV2ItemById` on content that is already in the Project returns the existing item or errors. The port checks `issue.projectItems` first, so this only matters for a race.
- An explicit docs sentence that issue types are unavailable to personal accounts. The evidence is the organization-only docs, the `/orgs/` endpoints, the gh changelog sentence and the live `null`.
- Whether the `Auto-add sub-issues to project` workflow is on by default for new Projects. Seen enabled on Project 3; not on Project 1. Not relied on.
- Whether a fine-grained PAT will support user Projects later. Not relied on; the Plan needs a classic token and says so.
- The REST `DELETE` for a user Project's item (absent from the fetched reference page). Not used; GraphQL `deleteProjectV2Item` is.
- Whether the roadmap layout's "Start date" and "Target date" field choice can be set through the API. `ProjectV2View` has no such fields and `createProjectV2View` takes an opaque `configuration`; the person sets "Date fields" once on GitHub, and `setup_plan` says so. The GraphQL reference's `ProjectV2ViewConfiguration` type would confirm it.
- Whether `ProjectV2FieldValue.date` accepts a date with a time, or only `YYYY-MM-DD`. The docs say "ISO 8601 date" and the filters use `YYYY-MM-DD`; handoff writes dates only.
- Whether `Repository.issueTypes` returning `null` (not an empty list) is how GitHub signals "no types for this owner" in general, or specific to this account. The port treats `null` and empty alike: no types.

## Decisions

### 1. Hierarchy: sub-issues, with kind labels, three levels

Epic, story and task are issues in the project's repository. A story is a sub-issue of its epic, a task a sub-issue of its story, through GitHub's sub-issue relation (`createIssue(parentIssueId)` on create, `addSubIssue` on repair). GitHub shows the same tree on the issue page, in the Project's "Parent issue" grouping and in its hierarchy view, and computes `subIssuesSummary` per parent.

Kind marker: the labels `epic`, `story` and `task`, created by `setup_plan` with fixed colours and descriptions. Issue types would be the native marker, but they are organization-only and `null` on this account (Verified facts). Alternatives considered:

- Depth only (no parent means epic, one parent means story, two means task). Ambiguous for an epic with a direct task, invisible in GitHub's issue list and labels filter, and wrong for an issue someone nests four deep. Rejected as the marker; depth is used as the fallback when a label is missing, and the Plan tab shows "no kind label" so the person can fix it.
- A single-select "Kind" field on the Project. Only exists for items in the Project, needs a second write per issue, and is invisible on the issue itself. Rejected.
- Issue types with an organization. The right answer for a repository under an organization; the port reads `issueType` when present and prefers it to the label. Listed under Risks as the upgrade path.

Depth is limited to three in the shaping tools; the reader shows whatever GitHub has, up to GitHub's eight levels, with deeper issues under their nearest task-labelled ancestor.

### 2. Status lives in the Project's Status field

One user-owned GitHub Project per handoff project, linked to the repository, with the built-in `Status` single select renamed to `Shaping`, `Ready`, `Running`, `In review`, `Done`. Status is written with `updateProjectV2ItemFieldValue` and read with the items query. A closed issue counts as Done whatever its Status says, since GitHub's default "Item closed" workflow sets Done on close and handoff's merge closes the issue.

Alternatives considered:

- Labels (`status:ready` and so on). Works without a Project and without the `project` scope, but gives no board on GitHub, no built-in Done-on-close, and the labels would pile up on the issue list. Rejected.
- Issue state only (open or closed). Cannot express Shaping, Ready or In review. Rejected.
- A `handoff_plan` table. Contradicts the user's decision. Rejected.
- A custom single select field named "handoff status" next to the built-in Status. Avoids renaming Status, but then GitHub's board and its default workflows track a different field than handoff does, and the person would see two statuses. Rejected.

Mapping from handoff's run states to Status, written by handoff:

| Transition in handoff | Status written | Where |
|---|---|---|
| A shaping tool creates an epic, story or task | Shaping | `apps/web/src/server/shaping.ts` |
| `move_to_ready` (a person, through an approval card or the Plan tab) | Ready | `shaping.ts` |
| A run starts on the task (`startRunFromGraph`) | Running | `apps/web/src/server/graphs.ts` |
| The PR node opens the pull request (first `github.pr` for the run) | In review | `packages/engine/src/executors/github.ts` |
| The merge node merged and `closeLinkedIssues` closed the issue | Done (GitHub's "Item closed" workflow also sets it) | `executors/github.ts` |
| The run is cancelled (`cancelRun`) | Ready | `packages/engine/src/operations.ts` |
| The run fails or is stuck | unchanged (Running); the card shows the failure | nothing |
| A run finishes without a pull request node | unchanged | nothing |

Epics and stories get no status writes from runs. Their progress is derived in the Plan tab from their descendants' statuses and from `subIssuesSummary` (GitHub counts closed sub-issues). Open question 6 asks whether handoff should also set a story's Status to Done when every task is done.

### 3. Ready is the gate

With a plan, the backlog of a project is: the tasks (label `task`) whose Status is Ready, that are open, that no run works on (the existing `isTodo` rule, where a cancelled run gives the task back), ordered with unblocked tasks first as today. Epics and stories never enter it. `start_run` refuses an issue whose Status is not Ready with a message naming its status, and refuses an epic or a story. `refuseBlocked` keeps refusing blocked tasks.

Issues that are not in the Project (a bug filed by hand, an issue from before the plan) are "unplanned". They stay in the backlog, marked unplanned, and remain startable. The Plan tab lists them under "Unplanned" with a "Plan it" action that adds the issue to the Project as a task in Shaping (open question 4 recommends this).

Projects without a plan (no `planProjectNumber`) behave exactly as today.

### 4. Sync: GitHub is read on demand, polled while the Plan tab is open, and wins on conflict

Reads: the Plan tab reads the Project's items and the backlog's issues on every render; a client component refreshes the page every 30 seconds while the tab is visible (`document.visibilityState`), and stops when hidden. The worker never polls the Project; it reads one issue's item only when it writes a status (two calls per transition). No handoff table caches any of it; `listBacklogOnce`-style per-request caching is the only cache.

Webhooks: `issues`, `sub_issues` and `issue_dependencies` are added to `scripts/forward-webhooks.sh` and to the GitHub App's event list in the README. They reach repository webhooks (Verified facts) and are stored in `webhook_deliveries` like every delivery. In v1 they trigger nothing; PR 7 adds a "last GitHub activity" hint on the Plan tab from them. Project status changes have no webhook for a user Project, so polling is the design, not a stopgap.

Conflict rules, in order:

1. GitHub holds the truth. handoff never argues with a value it reads; it displays it.
2. handoff writes Status only at the transitions in Decision 2, and overwrites whatever is there. A person who dragged a Running task to Ready during its run sees it go to In review when the pull request opens.
3. A person's move on GitHub's board never starts, cancels or merges anything. Dragging to Running without a run shows the card with "no run"; dragging to Ready while a run is active keeps the task out of the backlog (the run owns it) and the card shows the run.
4. A closed issue is Done. Reopening it keeps whatever Status GitHub shows (a reopened item keeps Done until someone moves it); the card shows "reopened" and the Shaping and Ready buttons.
5. Writes are idempotent and tolerant: a missing item (issue not in the Project), a missing option, or a 403 produce one `plan.skipped` run event with the reason and never fail a run. A missing `project` scope is reported once per worker start in the worker status and in the readiness check.

Alternatives considered: GitHub Actions in the user's repository that call the dashboard on `projects_v2_item` events (not available for user Projects either); a background poll in the worker every minute for every project (costs points for nothing while nobody looks, and the worker needs no live board); LISTEN/NOTIFY from webhooks (no webhook carries status).

### 5. Shaping through catalog tools with approval cards

New data tools in `apps/web/src/lib/assistant/catalog.ts`, so the dashboard assistant, the Claude Code plugin (`agent-mcp.ts`) and WebMCP get them from one place, with `confirm: true` on every write:

| Tool | Kind | What it does |
|---|---|---|
| `setup_plan({ project, use? })` | confirm, openWorld | Creates the labels `epic`, `story`, `task` if missing. With `use` (an existing Project's number) it adopts that Project: links it to the repository and sets its Status options to Shaping, Ready, Running, In review, Done, naming on the approval card any option it renames or adds. Without `use` it creates the user-owned Project "<project name> plan" with those options and links it. It stores the number on the handoff project. Idempotent: with a number already stored it re-checks fields and labels and reports. |
| `list_github_projects({ project })` | read | The person's own Projects v2, those linked to the project's repository first, each with title, number, URL and whether its Status options already match. Used by setup to ask before creating. |
| `list_plan({ project, epic? })` | read, untrusted | The tree: epics with stories with tasks, each with number, title, status, kind, open blockers, latest run (id, status, url), PR number; plus unplanned issues. |
| `create_epic({ project, title, goal })` | confirm, openWorld | An issue labelled `epic`, body "## Goal" plus the text, added to the Project in Shaping. |
| `create_story({ project, epic, title, acceptance[], start?, target? })` | confirm, openWorld | A sub-issue of the epic labelled `story`, body "## Acceptance criteria" as checkboxes, Shaping, with Start and Target set when given. |
| `create_task({ project, story, title, brief, acceptance?[], blocked_by?[], start?, target? })` | confirm, openWorld | A sub-issue of the story labelled `task`, body with the brief (goal, where in the code, how to tell it is done) and optional criteria, blockers linked with `addBlockedBy`, Shaping, with Start and Target set when given. |
| `schedule({ project, items: [{ issue, start?, target? }] })` | confirm | Sets, moves or clears (null) Start and Target on epics, stories or tasks, each item with its own dates, so one call can lay out a story's tasks one after another. Refuses a Target before its Start, a date that is not `YYYY-MM-DD`, an issue that is not in the Project, and a Project without the date fields (it names `setup_plan`). The approval card lists each issue with its old and new dates. |
| `move_to_ready({ project, issues[] })` | confirm | Sets Ready on tasks only. Refuses an epic or a story, a closed issue, a task with an empty body, and a task that is not in the Project. |
| `move_to_shaping({ project, issues[] })` | confirm | Sets Shaping on tasks in Ready. Refuses a task with an active run. |
| `plan_issue({ project, issue, story? })` | confirm | Adds an unplanned issue to the Project as a task (label, optional parent), Shaping. |

The approval card's `summarize` names the kind, the title and the parent ("Create task 'Add the migration' under story #41 in handoff"); the card's collapsible arguments show the body the model wrote, so the person reads what will land on GitHub. The assistant proposes dates only when the person asks to plan the timeline ("schedule the epic over October"); it then calls `list_plan`, works out an order from the blocked-by links, and proposes one `schedule` call per story with its tasks, each an approval card. Nothing in the system prompt asks it to date issues on its own. `list_plan` results are wrapped as data like `list_backlog`, since titles and bodies come from GitHub.

The `handoff` skill gains a "Shape first" section: `setup_plan` once, then `create_epic`, `create_story`, `create_task` with the user, then `move_to_ready` when a story is shaped, then `list_backlog` and `start_run` as today. `gh issue create --parent` (gh 2.94 or later) stays documented as the manual route; the tools are preferred because they add the item to the Project and set Shaping in the same step and because they show an approval card.

Alternatives considered: the assistant writing issues through `gh` in a shell (the assistant has no shell by design); a shaping form in the dashboard (useful later; the assistant and the plugin are the user's stated entry point); GitHub's own "Create sub-issue" UI (works, and the reader picks it up, but nothing sets the label or Shaping, so the Plan tab shows "no kind label" and the item sits wherever the Project put it).

### 6. Access: a classic token with the `project` scope, never the GitHub App

A new `ProjectsPort` lives next to `GitHubPort` in `packages/github`. `projectsFromEnv` builds it from `GITHUB_TOKEN` only. When the environment has only the App, or a token without `project`, the port is `undefined`: the Plan tab says what is missing, the shaping tools refuse with the same sentence, runs write no status and record `plan.skipped`, and the readiness check `plan` is `todo` with the fix (`gh auth refresh -s project`, then `GITHUB_TOKEN=$(gh auth token)`). The user's current token already has the scope (Verified facts).

The port checks the scope once at startup with `GET /user` and the `X-OAuth-Scopes` header (classic tokens only; a fine-grained token has no such header and cannot reach user Projects, so it is reported as unsupported for the Plan).

### 7. What handoff stores

One nullable column, `projects.plan_project_number` (integer), set by `setup_plan` or by the Settings tab ("Use an existing GitHub Project" with its number). Field and option ids are read from GitHub on each use and cached per process for ten minutes keyed by project number, since they do not change unless someone edits the Project; a write that fails with an unknown option id clears the cache and retries once.

Alternative: discover the Project through `repository.projectsV2` (the Projects linked to the repository) and pick the one whose Status options match. No column, but ambiguous with two linked Projects and silent when someone links a roadmap. Rejected; the column is configuration, not plan data.

### 8. Dates live on the Project as two Date fields, Start and Target

`setup_plan` creates two Date fields on the Project, `Start` and `Target`, the same pair GitHub's roadmap layout reads once a person picks them under "Date fields" (Verified facts). Any item can carry them: a task, a story or an epic. handoff reads them with the items query and writes them with `updateProjectV2ItemFieldValue(value: { date })`, or clears them with `clearProjectV2ItemFieldValue`. GitHub stays the source of truth: the dashboard's timeline shows what the Project holds, and a date moved on GitHub's roadmap shows on the next refresh.

A story or an epic without dates gets a derived span, from the earliest Start to the latest Target of its descendants, drawn as derived (Design, Timeline view). A story or an epic with its own dates keeps them, and descendants outside that window are flagged.

Actual time comes from handoff: each run that linked the task is a strip from `runs.startedAt` to `runs.finishedAt` (to now while active), coloured by the run's status. It is never written to GitHub.

Dependencies come from the blocked-by links handoff already reads. A task whose Start has passed while a blocker is not done is late ("Late: waiting on #55"); a task whose Target has passed while it is not done is overdue. Both are derived at read time, never stored.

Alternatives considered:

- An Iteration field (sprints). GitHub creates three iterations by default and the roadmap can use an iteration as both start and target. Iterations are coarser than the user's "you can't start this until that is done" view, need a cadence decision, and give an epic no span of its own. Rejected for v1; the port reads an Iteration value when a Project has one and the timeline shows it as a bar, so a person who prefers sprints can switch the roadmap's "Date fields" to it later.
- An Estimate number field with automatic scheduling: handoff would compute each task's Start from its blockers' Targets and its Target from an estimate, and write both. This is the natural next step once dates exist, but it makes handoff write dates nobody typed, which conflicts with GitHub as the truth unless every write is approved. Recorded as a later step behind a `schedule` call with `propose: true`, not built now.
- Milestones as targets. One date per milestone, no start, and milestones are per repository rather than per item. Rejected as the primary date; the roadmap's milestone markers remain available on GitHub.
- Dates in issue bodies ("Target: 2026-11-01"). Invisible to GitHub's roadmap and to filters. Rejected.

## Design

### Files

```
packages/github/src/
  projects/types.ts            ProjectsPort, PlanStatus, PlanItem, PlanKind, PlanProject
  projects/octokit-projects.ts OctokitProjects (GraphQL through octokit.graphql and paginate)
  projects/from-env.ts         projectsFromEnv(env): ProjectsPort | undefined (GITHUB_TOKEN only)
  projects/kinds.ts            kindOf(labels, issueType, depth): PlanKind | undefined; STATUS_OPTIONS
  queries/plan-items.graphql   PlanItems(login, number, cursor): items with fieldValues and issue content
  queries/issue-plan.graphql   IssuePlan(owner, name, number): projectItems, parent { parent }, labels
  testing/fake-projects.ts     FakeProjects: in-memory Project per repo, statuses, parents, labels
  schema/schema.docs.graphql   vendored copy of GitHub's published schema (codegen source), with scripts/refresh-schema.sh
packages/db/src/schema/projects.ts   plan_project_number
packages/core/src/schema/run-state.ts  LinkedIssueSchema.lineage
packages/core/src/context/render.ts    "Part of" section
packages/engine/src/executors/github.ts  In review and Done writes
packages/engine/src/operations.ts        Ready on cancel
apps/web/src/server/
  plan.ts                      loadPlan(db, github, projects, projectId): PlanView (tree, board, unplanned) | { error }
  shaping.ts                   setupPlan, createEpic, createStory, createTask, moveToReady, moveToShaping, planIssue, schedule
  backlog.ts                   the Ready gate
  graphs.ts                    Running on start, refusals, lineage in linkIssues
  readiness.ts                 the plan check
apps/web/src/lib/
  project-tab.ts               plan tab, parsePlanView, parsePlanFilters
  paths.ts                     planPath(projectId, { view, epic, status })
  assistant/catalog.ts         the shaping tools and go_to_plan
apps/web/src/components/plan/
  plan-tab.tsx                 server component: header, view toggle, filters, tree or board
  plan-tree.tsx                epics, stories, tasks with progress
  plan-board.tsx               five columns of task cards
  plan-card.tsx                one task card
  plan-filters.tsx             epic, status, run filters in the URL
  plan-actions.tsx             Move to Ready, Back to Shaping, Plan it (server actions with confirm dialogs)
  plan-refresher.tsx           router.refresh every 30 s while visible
  plan-empty.tsx               the empty states
  plan-timeline.tsx            the timeline: axis, rows, bars, arrows (SVG), hover cards
  plan-timeline-list.tsx       the narrow-screen list form of the timeline
  schedule-dialog.tsx          Start and Target inputs behind a confirmation
apps/web/src/lib/plan/
  schedule.ts                  deriveSpans(items, runs, today): planned, derived, actual, late, overdue, arrows; pure
  timeline-scale.ts            weeks and months scales, today, visible range; pure
apps/web/src/app/projects/[projectId]/page.tsx   PlanTab
apps/web/src/app/projects/actions.ts             moveToReadyAction, moveToShapingAction, planIssueAction, setupPlanAction
plugins/handoff/skills/handoff/SKILL.md          Shape first
plugins/handoff/skills/handoff-setup/SKILL.md    A plan on GitHub Projects
scripts/forward-webhooks.sh                      issues, sub_issues, issue_dependencies
```

### The Projects port

```ts
export type PlanStatus = "Shaping" | "Ready" | "Running" | "In review" | "Done";
export type PlanKind = "epic" | "story" | "task";
export type PlanItem = {
  number: number; title: string; url: string; state: "open" | "closed";
  kind: PlanKind | undefined;            // from the label, else issueType, else depth; undefined when none fits
  status: PlanStatus | undefined;        // undefined for an option handoff does not know
  parent: number | undefined;            // the parent issue's number, same repository
  labels: string[]; assignees: string[];
  subIssues: { total: number; completed: number };
  blockedBy: number[];                   // open blockers
  prNumbers: number[];                   // linked pull requests GitHub knows
  updatedAt: string;
  start: string | undefined;             // YYYY-MM-DD from the Start field, when the Project has it
  target: string | undefined;            // YYYY-MM-DD from the Target field
  iteration: { title: string; startDate: string; duration: number } | undefined;  // read only, shown when a Project uses one
};
export type PlanProject = {
  number: number; url: string; title: string;
  statusOptions: Record<PlanStatus, string | undefined>;
  dateFields: { start: string | undefined; target: string | undefined };   // field ids, undefined until setup_plan created them
};

export interface ProjectsPort {
  /** The Project by number for a user; undefined when it does not exist or the token cannot see it. */
  getProject(login: string, number: number): Promise<PlanProject | undefined>;
  /** Every item that is an issue of `repo`, across pages; draft issues and pull requests are skipped. */
  listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]>;
  /** An issue's Status in the Project, or undefined when it is not an item. */
  getStatus(repo: RepoRef, project: number, issue: number): Promise<PlanStatus | undefined>;
  /** Sets Status; adds the issue to the Project first when `add` is true; returns what it did. */
  setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts?: { add?: boolean }): Promise<"set" | "not-in-project" | "no-option">;
  createProject(login: string, repo: RepoRef, title: string): Promise<PlanProject>;   // createProjectV2, updateProjectV2Field on Status, linkProjectV2ToRepository
  ensureLabels(repo: RepoRef): Promise<void>;                                            // epic, story, task
  createIssue(repo: RepoRef, input: { title: string; body: string; labels: string[]; parent?: number; blockedBy?: number[] }): Promise<{ number: number; url: string }>;
  /** The chain of parents, nearest first, each with title, body and kind. */
  lineage(repo: RepoRef, issue: number): Promise<{ number: number; title: string; body: string; kind: PlanKind | undefined }[]>;
  /** Sets or clears (null) the Start and Target dates of an issue's item; "no-field" when the Project has no such field. */
  setDates(repo: RepoRef, project: number, issue: number, dates: { start?: string | null; target?: string | null }): Promise<"set" | "not-in-project" | "no-field">;
  /** Creates the Start and Target Date fields when missing and returns their ids. */
  ensureDateFields(login: string, number: number): Promise<PlanProject["dateFields"]>;
  scopes(): Promise<{ project: boolean; classic: boolean }>;
}
```

`OctokitProjects` uses `octokit.graphql.paginate` for `PlanItems` (`pageInfo { hasNextPage endCursor }` on `items`), typed through codegen against the vendored published schema (the npm schema lacks `blockedBy`), and `octokit.graphql` for mutations. `createIssue` is one `createIssue` mutation with `parentIssueId` and `labelIds`, then `addBlockedBy` per blocker, then `setStatus(..., { add: true })`. `setStatus` reads `issue.projectItems(first: 20)` to find the item in the Project, adds it with `addProjectV2ItemById` when `add` is set and it is missing, and calls `updateProjectV2ItemFieldValue` with the cached field and option ids.

`FakeProjects` keeps `Map<repoKey, { project: PlanProject; items: Map<number, { status; parent; labels; ... }> }>` and shares issue state with `FakeGitHub` through a constructor argument, so a test that closes an issue in `FakeGitHub` sees `state: "closed"` in the plan. Tests mutate `FakeProjects.items` directly to simulate a person dragging a card.

### The plan read model

`loadPlan` runs one `listItems` call (1 to 2 GraphQL calls), the existing `listBacklogOnce` (open issues and runs), and joins by issue number:

- Tree: epics (kind `epic`, or kind undefined with no parent) in `updatedAt` order, stories under their epic, tasks under their story. A task whose parent is an epic hangs under the epic directly. An issue with a parent that is not in the Project is listed under "Unparented" with its parent's number.
- Progress per epic and story: counts of descendants by status, `done = closed or Done`, and GitHub's `subIssues.completed/total` for the direct children.
- Board: tasks only, grouped by status; closed tasks go to Done whatever their Status; a task with an unknown option goes to a sixth group "Other" that only shows when non-empty.
- Each task carries `run` from the backlog join (`BacklogRun`), `blocked` (open blockers), `needsYou` (the run has an open question, a permission request or a failed step, from `inboxGroups`), and `pr`.
- Unplanned: open issues from the backlog that are not items of the Project.
- Timeline (`deriveSpans` in `apps/web/src/lib/plan/schedule.ts`, pure, tested on its own): per item a `planned` span (own Start and Target), a `derived` span for a story or an epic without dates (earliest descendant Start to latest descendant Target, undefined when no descendant has dates), `actual` strips from every run that linked the task (`startedAt` to `finishedAt` or now, with the run's status), `arrows` from each open or closed blocker to the blocked task, `late` when today is past Start and a blocker is not done, `overdue` when today is past Target and the task is not done, `outsideParent` when a task's span leaves its story's own window, and `unscheduled` for items with neither date. A task with only one of the two dates is drawn as a one-day bar with a dashed edge on the missing side.

The Ready gate is a change in `listBacklog`: when the project has `planProjectNumber` and a `ProjectsPort`, the issue list is filtered to tasks in Ready plus unplanned issues, each `BacklogIssue` gaining `plan: { kind, status, planned: boolean } | null`. `start_run`'s refusal lives in `startRunFromGraph` next to `refuseBlocked`.

### Status writes

`startRunFromGraph` sets Running on every linked task after `createRun` succeeds (`projects.setStatus`), recording `plan.status { issue, status: "Running" }` or `plan.skipped { reason }` as the run's first events. The engine's executor context gains `projects?: ProjectsPort` (wired in `apps/worker/src/app.ts` from `projectsFromEnv`), and the PR node sets In review the first time it records `prNumber`; the merge path sets Done after `closeLinkedIssues`. `cancelRun` sets Ready for the run's tasks when the cancelled run was the latest run on them. Every write is behind `try` with a `plan.skipped` event; a status write never fails a step.

### Context for agents

`LinkedIssueSchema` gains `lineage: z.array(z.object({ kind, number, title, body })).optional()`, nearest parent first, filled by `linkIssues` through `projects.lineage` (or `github.getIssue` on each `parent` when no `ProjectsPort` exists; the parent chain is a GitHub issue feature, not a Project feature). `render.ts` prints, before each issue's body:

```
## Part of
Story #41 "Shaping with the assistant": <body, cut at 4,000 characters with "(cut)" when longer>
Epic #12 "Project management": <body, cut the same way>
```

The planner's acceptance criteria rule is unchanged: the task's own checkboxes count; a story's criteria are context.

### Plugin and skills

The plugin needs no code change: `agent-mcp.ts` registers the catalog's data tools, so the new tools appear in the next `tools/list`. `plugins/handoff/skills/handoff/SKILL.md` gets the "Shape first" section (Decision 5) and the existing "Plan work as issues" section becomes the path for projects without a plan. `handoff-setup/SKILL.md` gets "A plan on GitHub Projects" (what `setup_plan` creates, the `project` scope, and that a GitHub App cannot do it). The readiness check `plan` is `info` when no plan exists ("Set up a plan to shape epics, stories and tasks"), `ok` with the Project URL, `todo` when a number is stored but the token cannot reach it.

### UI: the Plan tab

This section is written for a designer. Components are shadcn on Tailwind, as the rest of the dashboard; names in quotes are the visible labels.

Placement (decided by the user on 2026-10-02): the Plan is its own page at `/projects/<id>/plan`, with the crumbs "Projects > <project> > Plan", so it has room to grow (an epic page at `/projects/<id>/plan/epics/<number>` later). The project page's tab bar keeps a "Plan" entry, between "Runs" and "Issues", with a count pill of tasks in Ready; it links to the Plan page, so the plan reads as part of the project. Under the page header, one row: a segmented control "Tree | Board | Timeline" on the left (`?view=tree|board|timeline`, tree by default), the filters in the middle, and on the right two buttons: "Shape with the assistant" (opens the assistant panel with the composer prefilled "Shape work in <project>: ") and "Open on GitHub" (the Project's URL, external link icon).

Filters, each a popover select that writes to the URL (`?epic=<number>&status=<Shaping,Ready,...>&run=any|active|needs-you|none`), with a clear chip row underneath when any is set:

- "Epic": all epics by title, plus "Unplanned".
- "Status": multi-select of the five statuses; defaults to all.
- "Run": any, has an active run, needs you (question, permission request or failed step), no run.

Tree view: a list of epic blocks. An epic block has a header row: a chevron (collapsed state remembered per browser), the kind badge "Epic", `#12` in monospace, the title, a progress bar (five segments coloured by status, Done first) with the text "3 of 8 done", and an overflow menu ("Open on GitHub", "Collapse all stories"). Under it, story rows indented one level with the same shape (badge "Story", number, title, progress bar "1 of 3 done", and "Blocked" with a lock icon when any task is blocked). Under a story, task rows indented two levels: a status pill (the five statuses, each with its colour: Shaping grey, Ready blue, Running amber with a spinner when a run is active, In review purple, Done green), `#57`, the title, then on the right: a blocked chip "Blocked by #55" when open blockers exist, the run cell (nothing, or the run's `StatusBadge` as the Runs table uses it, linking to the run page; "Needs you" in the warning colour when the run waits on a person, linking to the inbox narrowed to the project), the PR cell (`#88` with the pull request icon, external link), and a row action: in Shaping "Move to Ready", in Ready "Back to Shaping" or "Start run" (the existing `StartRunDialog` with the task preselected), in Running or In review nothing, in Done nothing. Row actions open a small confirm dialog naming the task; they call the server actions that use `shaping.ts`. Tasks without a kind label show a muted "no kind label" tag; issues under "Unparented" show "parent #n is not in the plan". A final block "Unplanned" lists open issues outside the Project with "Plan it" (a dialog: optional story, then adds it in Shaping) and the existing "Start run".

Board view: five columns, "Shaping", "Ready", "Running", "In review", "Done", each with its count, full height, horizontally scrollable under 1,100 px. A card: the epic's title as a muted eyebrow line (truncated), `#57` and the title on one or two lines, then a footer with the blocked chip, the run badge or "Needs you", the PR number, and the assignee avatar when GitHub has one. Clicking the title opens the GitHub issue; clicking the run badge opens the run; the card's overflow menu has the same row actions as the tree. The Done column shows only tasks closed or moved in the last 30 days, with "Show all" at the bottom. No drag and drop on the dashboard's board: the column header's overflow menu says "Drag cards on GitHub" with the Project link.

Timeline view (`?view=timeline`): a Gantt chart for the project manager. The layout is two panes: a fixed left pane of row labels (280 px, sticky) and a right pane that scrolls horizontally over the time axis; both scroll vertically together.

- Time axis: two header rows. At the "Weeks" zoom the top row shows months ("Oct 2026") and the bottom row ISO weeks ("W41", "W42") with one column of 7 day cells, each 14 px, weekend cells shaded. At the "Months" zoom the top row shows quarters ("Q4 2026") and the bottom row months, each month 120 px wide. A segmented control "Weeks | Months" sits at the top right of the chart (`?zoom=weeks|months`); the default is Weeks when the visible span is under ten weeks, else Months. The visible range runs from one week before the earliest Start (or today) to two weeks after the latest Target (or today), and never less than eight weeks around today. A vertical "Today" line in the accent colour with the label at the top; a "Today" button scrolls to it.
- Rows, grouped as the tree: an epic row, its story rows indented, their task rows indented twice, with the same chevrons and collapsed state as the Tree. A row label shows the kind badge, the number and the title, truncated with the full title in the hover card; a task label also shows the status pill. The row filters (Epic, Status, Run) and the chip row are the ones the Tree and Board use.
- Planned bars: a task's bar spans Start to Target, filled with the status colour (Shaping grey, Ready blue, Running amber, In review purple, Done green) at 70 percent opacity with a 2 px border in the full colour, 20 px tall, rounded; the title repeats inside the bar when it is wider than 120 px. A story's or an epic's bar with its own dates is the same shape in a neutral colour with a thin progress fill (done tasks over all tasks) along its bottom edge. A derived bar (no own dates) is an outlined bracket in the neutral colour with a dashed border and the tooltip "Derived from its tasks". A one-sided bar (only Start or only Target) is one day wide with a dashed edge on the missing side.
- Actual strips: under each task's planned bar, one 6 px strip per run that linked the task, from the run's start to its end (to the Today line while active), in the run's status colour (`StatusBadge` colours), with a 2 px gap between strips, newest at the top. A strip wider than 40 px shows the run's short id; hovering shows the run's task and status; clicking opens the run page. A task with runs but no dates shows its strips alone, aligned to the actual time.
- Dependency arrows: an SVG layer draws an orthogonal arrow from the right edge of each blocker's bar (or strip, when the blocker has no bar) to the left edge of the blocked task's bar, with a small arrowhead, in the muted foreground colour; arrows to or from a collapsed group end at the group's row. Hovering a task highlights its arrows and the bars at both ends; a task with blockers in another epic still gets its arrows. The arrow turns red when the blocked task is late.
- Late, blocked and overdue: a late task's row label gets a red chip "Late: waiting on #55" (several blockers: "waiting on #55, #56"), its bar a red left border and the arrow turns red. A blocked task that is not yet late (Start in the future, blocker open) gets the grey "Blocked by #55" chip the Tree uses. An overdue task gets an amber chip "Overdue by 3 days" and its bar extends with a hatched tail from Target to today. A task outside its story's window gets the chip "Outside story window".
- Unscheduled: below the chart, a block "Unscheduled" lists items with no Start and no Target, grouped by epic, each row with the kind badge, number, title, status pill and a "Schedule" button. The header shows the count; the block collapses.
- Interactions: hovering a bar, a strip or a row label shows a hover card with the title, kind, status, Start, Target, the derived or own origin of the span, the blockers with their statuses, the latest run and the pull request, and a "Open on GitHub" link. Clicking a bar opens the issue on GitHub; clicking the row title does the same; clicking a strip opens the run. A "Schedule" entry in the row's overflow menu (and the button in Unscheduled) opens the schedule dialog: two date inputs "Start" and "Target" prefilled with the current values, a "Clear" link per field, a note line showing the parent's window when the task has one, and a "Save to GitHub" button that is disabled until the dates are valid (Target on or after Start); saving calls `scheduleAction`, which writes through `projects.setDates`, and the page refreshes. No bar drags in v1 (open question 10); the chart header's overflow says "Drag dates on GitHub's roadmap" with the Project link.
- Empty and edge states: a Project without the date fields shows a banner at the top of the chart, "This Project has no Start and Target fields", with a "Add date fields" button (confirm, then `ensureDateFields`) and the note that GitHub's roadmap needs them picked once under "Date fields". A plan with items but no dates at all shows the chart with only Today and actual strips, and the Unscheduled block expanded with the text "Give tasks a Start and Target to see them on the timeline, or ask the assistant to schedule an epic." Filters that match nothing show "No items match these filters" with "Clear filters".
- Narrow screens: under 900 px the right pane scrolls horizontally with the row labels sticky; under 640 px the timeline switches to a list form (`plan-timeline-list.tsx`): one row per item in tree order with a mini bar (the planned span against the visible range, 4 px tall), the dates as text ("Oct 6 to Oct 17"), the late or overdue chip, and the latest run's actual dates; arrows are replaced by the "waiting on" text.
- Accessibility: the chart is `role="grid"` with rows labelled by their title; bars and strips are focusable buttons whose accessible name reads "Task #57 Add the migration, Ready, Oct 6 to Oct 17, blocked by #55"; the arrows are decorative (`aria-hidden`) because the chips carry the same information; the schedule dialog is a Radix dialog that returns focus to the row; colours are never the only signal (chips and borders repeat them).

Empty states (the `Empty` component as the Issues tab uses it):

- No plan yet: title "No plan on GitHub yet", text "handoff can create a GitHub Project for this repository with the columns Shaping, Ready, Running, In review and Done, and the labels epic, story and task.", button "Set up the plan". The button opens a dialog that asks first (decided by the user on 2026-10-02): it lists the person's existing Projects from `list_github_projects`, those linked to the repository first, each with "Use this Project" (and a note when its Status options will be renamed), plus "Create a new Project", which is the default and the only choice when none exist. The choice calls `setupPlanAction` with or without `use`. When the token lacks the `project` scope: title "GitHub Projects need the project scope", text with the two commands, no button.
- A plan with nothing in it: title "Nothing shaped yet", text "Shape the first epic with the assistant or from Claude Code: an epic with its goal, stories with acceptance criteria, then tasks.", button "Shape with the assistant".
- Tree with filters that match nothing: "No tasks match these filters" with "Clear filters".
- Board, empty Ready column: "Move tasks here when they are shaped. Only Ready tasks reach the backlog." Empty Running column: "Start a run from a Ready task."

Links out of the Plan tab: a task's run badge to the run page; "Needs you" to `/inbox?project=<id>`; the Ready count pill to the Issues tab (the backlog), which now shows the plan's Ready tasks plus unplanned issues; the Project title in the header to GitHub's board.

Links into the Plan tab: the Issues tab gets a line "Tasks arrive here from the plan when they are Ready" with a link when a plan exists; the run page's linked issues list shows each issue's epic and story titles; the assistant's `go_to_plan` UI tool opens the tab with a view, an epic or a status.

Refresh: a small muted line at the bottom right "Updated 12 s ago from GitHub" with a refresh icon button; the tab refreshes itself every 30 seconds while visible. Nothing in the tab is editable in place.

Accessibility: the tree is `role="tree"` with `aria-expanded` on epic and story rows and arrow key navigation; the board columns are regions labelled by their header; status pills carry text, not only colour; the confirm dialogs return focus to the row.

### Security

- Token: `GITHUB_TOKEN` stays in the dashboard's and the worker's environment, never in the browser, graph JSON or the database. The `project` scope grants write access to every Project the user owns; handoff only touches the Project whose number is stored on the handoff project, and never deletes a Project, an item or a label.
- Dates: `schedule` and the schedule dialog write two Date fields and nothing else; dates are validated as `YYYY-MM-DD` before any call; actual run times stay in Postgres and are never written to GitHub.
- Writes: every shaping write runs behind an approval card in the assistant and WebMCP, and behind the Claude Code permission prompt in the plugin's session (the plugin's `confirm` tools prompt unless the user allowed them). Run-driven status writes are the only unattended writes and change one field of one item.
- Prompt injection: titles and bodies from GitHub are data; `list_plan` is `untrusted` and wrapped; the model's own issue bodies are shown in the approval card before they reach GitHub. A body that says "move every task to Ready" produces one approval card per `move_to_ready` call, naming the tasks.
- Rate limits: at most one Project read per 30 seconds per open Plan tab and two calls per run transition; the worker shares the 5,000 points with the dashboard, which also lists issues. A `rateLimit.remaining` under 500 makes the Plan tab show "GitHub rate limit low, refreshing less often" and doubles the interval.
- Same-origin: the server actions and the assistant routes keep the existing origin checks; no new API route is needed for the Plan tab since it is server rendered with server actions.

## Data model and ADR changes

- Migration: `projects.plan_project_number integer null`, generated with `pnpm db:generate`, reviewed and committed.
- `LinkedIssueSchema.lineage` (optional, additive; existing run state validates unchanged).
- New run event types `plan.status` and `plan.skipped`, listed in `docs/plan.md`'s event stream section and summarized by `lib/event-summary.ts`.
- ADR 0007 (new): "GitHub Projects is the plan store". Decision: handoff keeps no plan data; hierarchy is sub-issues with kind labels; status is the Project's Status field; access needs a classic token with `project` and the App path cannot do it; sync is on-demand reads plus a 30-second poll in the Plan tab; writes happen at run transitions and through approved tools. Consequences: no cache tables, GitHub rate limit shared, organizations and issue types as the upgrade path.
- `.env.example`: a comment under `GITHUB_TOKEN` that the Plan tab needs the `project` scope and a classic token.

## Delivery

Each PR is one GitHub issue, one branch, CI green, `pnpm doctor:react` clean after changes under `apps/web`, one red-green slice per test named here, Context7 before writing against Next 16, React 19, Zod 4, Octokit 5, Drizzle or Vitest 5. Test names use the glossary. PRs 1 and 6 are independent; 2 needs 1; 3 needs 2; 4 needs 2; 5 needs 2 and 4; 7 needs 3 and 5; 8 needs 2 and 5; 9 needs 4 and 8.

1. **Projects port.** Files: `packages/github/src/projects/{types,octokit-projects,from-env,kinds}.ts`, `queries/plan-items.graphql`, `queries/issue-plan.graphql`, `schema/schema.docs.graphql` with `scripts/refresh-schema.sh`, `codegen.ts` pointing at the vendored schema, `testing/fake-projects.ts`, exports. First tests: `projects/octokit-projects.test.ts` (fake fetch over `POST /graphql`) "listItems reads every page of a Project and returns the repository's issues with status, kind, parent, sub-issue counts, open blockers and linked pull requests"; "listItems skips draft issues, pull requests and issues of other repositories"; "setStatus finds the issue's item and sets the Status option by id, and reports not-in-project when the issue is not an item"; "setStatus with add adds the issue to the Project first"; "createProject creates a user Project, renames the Status options keeping Done, links the repository and returns the option ids"; "createIssue sends the parent, the labels and the blockers, and leaves the issue in Shaping"; "lineage walks parent then grandparent with their bodies and kinds"; `projects/kinds.test.ts` "kindOf prefers the label, then the issue type, then depth, and is undefined past three levels"; `projects/from-env.test.ts` "projectsFromEnv returns a port for GITHUB_TOKEN and undefined for a GitHub App alone"; "scopes reports project missing from a token's X-OAuth-Scopes". Manual step recorded in the PR: create a throwaway Project with the port, list its `workflows`, close a test issue in it, record the column it lands in, delete the Project by hand.

2. **Plan read model, the column and the Ready gate.** Files: migration, `packages/db/src/schema/projects.ts`, `apps/web/src/server/plan.ts`, `backlog.ts`, `graphs.ts` (refusals only), `lib/project-tab.ts`, `lib/paths.ts`. First tests: `server/plan.integration.test.ts` (real Postgres, `FakeGitHub` and `FakeProjects`) "loadPlan nests stories under their epic and tasks under their story, with each task's status, blockers and latest run"; "progress counts a story's tasks by status and marks closed tasks done whatever their status"; "a task whose parent is an epic hangs under the epic, and an issue whose parent is outside the plan is listed as unparented"; "open issues outside the Project are listed as unplanned"; "a task in an unknown status column is listed under other"; "without a plan number loadPlan says there is no plan, and without the project scope it says what is missing". `backlog.integration.test.ts` additions "with a plan, the backlog is the Ready tasks without a run plus the unplanned issues, blocked ones last"; "epics and stories never enter the backlog"; "a cancelled run gives a Ready task back". `graphs.integration.test.ts` additions "start_run refuses a task that is not Ready and names its status"; "start_run refuses an epic and a story"; "start_run starts an unplanned issue as before".

3. **Status writes from runs.** Files: `graphs.ts` (Running), `packages/engine/src/executors/github.ts`, `operations.ts`, executor context and `apps/worker/src/app.ts`, `lib/event-summary.ts`. First tests: `run-issues.integration.test.ts` additions "starting a run on a Ready task sets it to Running and records plan.status"; "a status write that fails records plan.skipped and the run continues". `executors/github.integration.test.ts` additions "opening the pull request sets each linked task to In review once"; "the merge sets Done after closing the issues". `packages/engine/src/plan-status.integration.test.ts` (new) "cancelling the latest run of a task sets it back to Ready"; "cancelling an older run leaves a task whose newer run is active alone". `apps/worker/src/plan-status.test.ts` (new) "the worker reports once that the Plan is off when the token lacks the project scope".

4. **Plan page.** Files: `components/plan/*`, `app/projects/[projectId]/plan/page.tsx`, `app/projects/[projectId]/page.tsx` (the "Plan" tab entry), `app/projects/actions.ts`, `components/projects/project-tabs.tsx`, `lib/project-tab.ts` (filters), catalog `go_to_plan` and `ui-tools.ts`. First tests (web): `components/plan/plan-tree.test.tsx` "the tree shows epics with their progress, stories under them and tasks with a status pill, a run link and a PR link"; "a blocked task shows its blockers and a task whose run needs a person links to the inbox for the project"; "Move to Ready appears only in Shaping and Back to Shaping only in Ready, each behind a confirm dialog that names the task"; "an issue without a kind label and an unparented issue say so"; `plan-board.test.tsx` "the board puts each task in its status column with the epic as its eyebrow and closed tasks in Done"; "the Done column shows the last 30 days and Show all reveals the rest"; `plan-filters.test.tsx` "epic, status and run filters live in the URL and narrow both views"; `plan-empty.test.tsx` "no plan offers Set up the plan, a missing scope shows the commands, an empty plan offers Shape with the assistant"; `plan-refresher.test.tsx` "the refresher calls router.refresh every 30 seconds while the document is visible and not while hidden"; `project-tabs.test.tsx` addition "the Plan tab shows the Ready count". `lib/assistant/ui-tools.test.ts` addition "go_to_plan opens the tab with a view, an epic or a status".

5. **Shaping tools.** Files: `apps/web/src/server/shaping.ts`, catalog entries, `agent-mcp.ts` handlers, `readiness.ts`, the two skills, `plugins/handoff/.claude-plugin/plugin.json` version bump, assistant system prompt line about shaping. First tests: `server/agent-mcp.integration.test.ts` additions "setup_plan creates the labels and the Project once, stores the number and is idempotent"; "create_epic creates an issue labelled epic in Shaping in the Project"; "create_story creates a sub-issue of the epic with its acceptance criteria as checkboxes"; "create_task creates a sub-issue of the story with its blockers linked and refuses a story that is not in the plan"; "move_to_ready sets Ready on tasks and refuses an epic, a story, a closed issue and a task without a body"; "move_to_shaping refuses a task with an active run"; "plan_issue adds an unplanned issue as a task under the given story"; "list_plan returns the tree with statuses and runs, wrapped as data"; "every shaping tool refuses with the scope sentence when the Projects port is missing". `lib/assistant/catalog.test.ts` additions "shaping writes are confirm and openWorld and their summaries name the kind, the title and the parent". `server/readiness.integration.test.ts` addition "the plan check is info without a plan, ok with one, and todo when the token cannot reach it". `packages/connector/src/plugin.test.ts` addition "the handoff skill shapes before it starts runs and names setup_plan, create_epic, create_story, create_task and move_to_ready".

6. **Parent context for agents.** Files: `packages/core/src/schema/run-state.ts`, `packages/core/src/context/render.ts`, `graphs.ts` (`linkIssues` lineage), `OctokitGitHub.getIssue` parent reading as the fallback. First tests: `packages/core/src/context/render.test.ts` additions "a linked issue with a story and an epic renders Part of before its body, story first"; "a parent body longer than 4,000 characters is cut with a note"; `run-issues.integration.test.ts` additions "a run on a task carries the parent story and epic in run state"; "a run on an issue without parents has no lineage"; `packages/github/src/octokit-client.test.ts` addition "getIssue reads the parent chain when asked".

7. **Webhooks, docs and the last GitHub activity line.** Files: `scripts/forward-webhooks.sh`, `README.md` (the Plan tab, the scope, the App limitation), `docs/plan.md` event list, ADR 0007, `.env.example`, `components/plan/plan-tab.tsx` activity line from `webhook_deliveries`. First tests: `packages/github/src/webhook-events.test.ts` addition "sub_issues and issue_dependencies deliveries wake nothing"; `server/github-webhook.integration.test.ts` addition "an issues delivery is stored with its repository id and action"; `plan-tab.test.tsx` addition "the activity line shows the latest issues, sub_issues or issue_dependencies delivery for the repository".

8. **Dates: port, read model and the schedule tool.** Files: `packages/github/src/projects/{types,octokit-projects}.ts` (`start`, `target`, `iteration`, `dateFields`, `setDates`, `ensureDateFields`; `createProject` creates the two Date fields), `queries/plan-items.graphql` (date and iteration values), `testing/fake-projects.ts`, `apps/web/src/lib/plan/schedule.ts`, `apps/web/src/server/plan.ts`, `shaping.ts` (`schedule`, dates on `createStory` and `createTask`), catalog entries, `agent-mcp.ts`, `app/projects/actions.ts` (`scheduleAction`, `addDateFieldsAction`). First tests: `projects/octokit-projects.test.ts` additions "listItems reads Start and Target as YYYY-MM-DD and an iteration's title, start and duration"; "setDates writes a date, clears one with null, and reports no-field on a Project without the fields"; "ensureDateFields creates Start and Target once and returns the ids"; "createIssue sets Start and Target after adding the item". `lib/plan/schedule.test.ts` (pure) "a task's planned span is its Start to Target and a one-sided date gives a one-day span marked open on the missing side"; "a story without dates derives its span from its tasks and a story with dates keeps them and flags a task outside its window"; "an epic without any dated descendant has no span and is unscheduled"; "actual strips come from each run's start and end, an active run ends today, newest first"; "a task is late when today is past its Start and a blocker is not done, and overdue when today is past its Target and it is not done"; "arrows run from each blocker to the blocked task and are red when the task is late". `server/plan.integration.test.ts` additions "loadPlan joins each task's runs into actual strips and marks late tasks from live blockers". `server/agent-mcp.integration.test.ts` additions "schedule sets Start and Target on epics, stories and tasks and lists old and new dates in its summary"; "schedule refuses a Target before its Start, a malformed date and an issue outside the Project"; "schedule on a Project without date fields names setup_plan"; "create_task with start and target sets them". `lib/assistant/catalog.test.ts` addition "schedule is confirm and its summary names every issue with its dates".

9. **Timeline view.** Files: `components/plan/{plan-timeline,plan-timeline-list,schedule-dialog}.tsx`, `lib/plan/timeline-scale.ts`, `lib/project-tab.ts` (`parsePlanView` with `timeline`, `parseZoom`), the Plan page's segmented control, `lib/assistant/ui-tools.ts` (`go_to_plan` with `view: "timeline"`). First tests (web): `lib/plan/timeline-scale.test.ts` "the weeks scale lays out day columns with week and month headers and the months scale lays out month columns with quarter headers"; "the visible range starts a week before the earliest Start and ends two weeks after the latest Target, and spans at least eight weeks around today"; `components/plan/plan-timeline.test.tsx` "rows follow the tree order with epics, stories and tasks, and a collapsed epic hides its rows"; "a task bar spans its dates in its status colour and a derived story bar is drawn dashed"; "actual strips render one per run under the planned bar and link to the run"; "a late task shows Late: waiting on its blockers with a red arrow and an overdue task shows Overdue by n days"; "an unscheduled item appears in the Unscheduled block with a Schedule button"; "the schedule dialog is prefilled, refuses a Target before Start, and saves through scheduleAction"; "the Weeks and Months zoom and the Today button live in the URL and scroll to today"; "a Project without date fields shows the banner and Add date fields"; `plan-timeline-list.test.tsx` "under 640 px the timeline lists items with their dates and waiting-on text instead of arrows"; `lib/assistant/ui-tools.test.ts` addition "go_to_plan opens the timeline view with a zoom".

## Risks

| Risk | Mitigation |
|---|---|
| The user switches to a fine-grained token or to the GitHub App alone, and the Plan silently stops | `projectsFromEnv` is undefined, the Plan tab and the readiness check say why, runs record `plan.skipped`, the worker status reports it once. |
| The "Item added to project" workflow sets a status after handoff set Shaping | handoff sets Shaping after adding; the manual step in PR 1 records the race; `deleteProjectV2Workflow` behind an approval is the fallback, documented in the setup skill. |
| Renaming Status options breaks the default Done workflows | `Done` keeps its name and id; the manual step verifies close and merge land in Done. |
| Someone enables "Auto-close issue" on the Project and drags a task to Done during its run | The run's PR still closes with `Closes`; the merge node's `closeIssue` tolerates an already closed issue; the card shows "closed" with the run. |
| Project webhooks stay organization-only, so the board is up to 30 seconds stale | Stated in the UI ("Updated n s ago") with a manual refresh; the worker never depends on the board. |
| Rate limit shared with issue listing, PR snapshots and the assistant | 1 to 2 points per read; the tab backs off under 500 remaining; the worker's reads are per transition only. |
| 100 sub-issues per parent and eight levels | The tools cap at three levels; the tree shows GitHub's counts; a story with 100 tasks is a shaping problem the Plan tab makes visible. |
| The same-owner rule for sub-issues | Stories and tasks are always created in the project's repository; `plan_issue` refuses an issue from another repository. |
| Kind labels removed or renamed by hand | `kindOf` falls back to depth and the tab shows "no kind label"; `setup_plan` recreates missing labels. |
| An organization repository later: issue types and org Projects | `kindOf` already prefers `issueType`; the port's `getProject` takes a login that can be an organization; webhooks for org Projects become possible; a follow-up plan. |
| `docs/plans/stacked-prs.md` also extends `LinkedIssue` and the PR node | Both changes are additive fields and one extra write; the stack plan's "top PR closes the issue" keeps the Done write on the last merge. |
| The published schema file drifts from the npm package | Vendored copy with a refresh script; codegen runs in CI; the runtime Zod checks on query results stay. |
| The roadmap's "Date fields" cannot be set through the API, so GitHub's roadmap shows nothing until a person picks Start and Target once | `setup_plan` and the banner say so with the two clicks; the dashboard's timeline does not depend on GitHub's roadmap. |
| Dates typed on GitHub's roadmap and dates written by `schedule` disagree for up to 30 seconds | GitHub wins; the timeline reads on every refresh and never caches dates; the schedule dialog is prefilled from the latest read and the approval card shows old and new values. |
| A chart with many arrows becomes unreadable | Arrows draw only for visible rows; hovering isolates one task's arrows; the Epic filter narrows the chart; the list form has no arrows. |
| Assistant-proposed dates land without thought | Each `schedule` call is an approval card listing old and new dates; the assistant proposes dates only when asked. |
| A task has runs over many days (repairs, re-runs) and the actual strips crowd the row | One strip per run, newest on top, at most five shown with "+n more" in the hover card. |

## Open questions

Each with a recommended answer. Unanswered, the implementation takes the recommendation. Questions 1, 3, 5 and 7 were answered by the user on 2026-10-02.

1. Should handoff create the GitHub Project (`setup_plan`) or should the person create it on GitHub and give handoff its number? Decided: setup asks first. It lists the person's existing Projects (those linked to the repository first) to use one, and creates a new Project when none exists or the person chooses "Create a new Project". Either way runs behind one approval card.
2. Kind marker: the labels `epic`, `story`, `task`, or depth only? Recommended: labels, with depth as the fallback (Decision 1).
3. Where do failed runs show on the board? Decided (to try): in Running with a red "failed" badge and the repair link, not a sixth column.
4. Should unplanned issues stay startable with a plan in place? Recommended: yes, marked unplanned, so bug fixes do not need shaping; "Plan it" moves them into the plan when wanted.
5. Should a person dragging a Running task to Ready on GitHub cancel its run? Decided by the user on 2026-10-02: no; a running task keeps running. A board move never changes a run. The card shows the run and the next transition writes the status back.
6. Should handoff set a story's and an epic's Status to Done when all their tasks are done? Recommended: not in v1; progress is derived and shown; a later PR can add it once the shape of stories in practice is known.
7. Should the Plan be a project tab or a top-level page across projects? Decided: its own page per project at `/projects/<id>/plan`, linked from a "Plan" entry in the project page's tab bar; a cross-project view can be added later.
8. Should Ready tasks of a story be released one at a time (the story's tasks run in order through blocked-by) or all at once? Recommended: all at once by default; `create_task` takes `blocked_by` so the shaping conversation decides the order, and the backlog already respects it.
9. Where do dates live: two Date fields Start and Target (recommended, Decision 8), an Iteration field, or an Estimate with automatic scheduling? Recommended: the two Date fields now; iterations readable when present; automatic scheduling as a later `schedule` with `propose: true`.
10. Should the dashboard's timeline drag bars? Recommended: no in v1; the schedule dialog behind a confirmation keeps every date write explicit, GitHub's roadmap already drags, and a drag with an approval card after it would feel broken. Revisit once the dialog has been used for a few weeks.
11. Should epics and stories carry their own dates or always derive them from tasks? Recommended: both allowed; an own date is a commitment the chart shows solid, a derived span is shown dashed, and tasks outside the window are flagged rather than clipped.
12. Should the assistant propose dates on its own after shaping a story? Recommended: no; only when asked, so shaping stays about scope and the timeline is a separate conversation.

## Verification

Tests and checks:

```bash
pnpm db:up
pnpm db:migrate
pnpm --filter @handoff/github codegen
pnpm test            # unit (projects port, kinds, catalog, render), integration (plan, backlog, graphs, engine writes, agent-mcp, readiness), web (plan tab)
pnpm typecheck && pnpm lint
pnpm doctor:react
```

By hand, with `GITHUB_TOKEN=$(gh auth token)` in `.env` on the Krister-Johansson/handoff project (or a sandbox repository), `pnpm dev:web`, `pnpm dev:worker` and `pnpm dev:webhooks Krister-Johansson/<repo>` running:

1. Open the project, Plan tab. Expect "No plan on GitHub yet" with "Set up the plan". Click it, confirm. Expect a Project "<name> plan" under github.com/users/Krister-Johansson/projects with Status options Shaping, Ready, Running, In review, Done, linked to the repository, and the labels epic, story, task on the repository. Record the Project's `workflows` from `gh api graphql`.
2. In Claude Code with the plugin, ask to shape an epic with two stories and three tasks. Expect one permission prompt per write, naming the kind, title and parent, and the issues on GitHub as sub-issues with the labels, every one in Shaping. In the Plan tab, expect the tree with the epic's progress "0 of 3 done" and the board with three cards in Shaping.
3. In the dashboard assistant, ask to move two tasks to Ready. Expect two approval cards; approve one, deny one with a note. Expect one card in Ready, the Ready count on the Plan tab and the Issues tab showing that task alone among planned issues.
4. Start a run on the Ready task from the Issues tab. Expect the task in Running with the run badge, `plan.status` in the run's events, and GitHub's board showing Running. Try `start_run` on the Shaping task: expect the refusal naming Shaping. Try it on the story: expect the refusal.
5. Let the run open its pull request. Expect In review on both boards within 30 seconds on the dashboard (watch "Updated n s ago"). Drag the card back to Ready on GitHub: expect the dashboard to show Ready with the run badge still attached and the task absent from the backlog.
6. Merge through the merge queue. Expect the issue closed, the card in Done on both boards, and the story's progress "1 of 3 done".
7. Cancel a second run from the inbox. Expect its task back in Ready.
8. On the run page, expect the linked issue to list its story and epic; in the run's Coder step events, expect the prompt's "Part of" section (through `get_run_events` or the step's transcript).
9. Remove the `project` scope from a throwaway token (`gh auth refresh` on a second account, or a fine-grained token) and restart `dev:web`: expect the Plan tab to show the scope message, the shaping tools to refuse with the same sentence, and a run to record `plan.skipped` while completing normally.
10. Open `gh api rate_limit` before and after ten minutes with the Plan tab open: expect at most 25 GraphQL points used by the tab.
11. Timeline: open `?view=timeline` on the plan from step 2. Expect the chart with the Today line, every item under Unscheduled, and the banner absent (the fields exist from `setup_plan`; on a Project adopted with `use`, expect the banner and press "Add date fields"). On GitHub, open the Project, add a Roadmap view and pick Start and Target under "Date fields"; record that the roadmap is empty too.
12. Ask the assistant to schedule the epic over the next four weeks. Expect one approval card per story listing each task with old (none) and new dates; approve them. Expect bars in the chart, the derived story and epic brackets, the arrows from the blocked-by links of step 2, and the same dates on GitHub's roadmap.
13. On GitHub's roadmap, drag one task a week later. Expect the dashboard to show the new dates within 30 seconds. Set a blocked task's Start to yesterday with the schedule dialog while its blocker is open: expect "Late: waiting on #n", the red arrow and the red bar edge. Set a Done task's Target to last week: expect no overdue chip.
14. Start a run on a Ready task with dates. Expect an actual strip from now, growing to the Today line on refresh, and after the run ends a strip from its start to its end in the run's status colour, with the run page opening on click. Resize the window under 640 px: expect the list form with the dates as text and "waiting on" instead of arrows.
