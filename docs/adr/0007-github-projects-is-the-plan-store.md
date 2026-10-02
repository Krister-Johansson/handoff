# 7. GitHub Projects is the plan store

Date: 2026-10-02. Status: accepted.

## Decision

handoff keeps no plan data. A project's plan of epics, stories and tasks lives on GitHub, and handoff reads it from there and writes status back as runs progress. `projects.plan_project_number` is the one column handoff stores: the number of the GitHub Project that belongs to the handoff project.

- Hierarchy is GitHub's sub-issue relation in the project's repository: a story is a sub-issue of its epic and a task a sub-issue of its story. The labels `epic`, `story` and `task` mark the kind, because issue types exist only for organizations. An issue type is used when the label is missing, and depth after that.
- Status is the built-in Status field of a user-owned GitHub Project (v2), with the options Shaping, Ready, Running, In review and Done. A closed issue counts as Done whatever its Status says.
- Access needs `GITHUB_TOKEN` as a classic token with the `project` scope. A fine-grained token cannot reach a Project owned by a user account, and a GitHub App cannot either, since GitHub offers a Projects permission only for organizations. Without such a token there is no Projects port: the Plan page and the shaping tools say what is missing, and runs record `plan.skipped`.
- Sync is reads on demand. The Plan page reads the Project on every render and refreshes every 30 seconds while the browser tab is visible. The worker never polls the Project; it reads one issue's item when it writes a status. GitHub sends no webhook for changes to a user-owned Project. The `issues`, `sub_issues` and `issue_dependencies` deliveries are stored like any other and wake nothing; the Plan page shows the latest one as its last GitHub activity.
- Writes happen at run transitions (Running on start, In review when the pull request opens, Done after the merge, Ready when the task's latest run is cancelled) and through shaping tools that show an approval card. A run-driven write that fails becomes a `plan.skipped` event and never fails the run. GitHub wins on conflict: handoff displays what it reads and overwrites Status only at those transitions.

## Consequences

- No cache tables and no copy of issues, statuses or hierarchy in Postgres. A change made on GitHub shows on the Plan page within 30 seconds, and nothing in handoff can drift from GitHub.
- The dashboard and the worker share the token's GitHub rate limit of 5,000 GraphQL points per hour with issue listing, pull request checks and the assistant. One read of a page of up to 100 Project items costs four points, and an open Plan page reads twice a minute.
- A person can move cards on GitHub's own board. A board move never starts, cancels or merges anything; the next run transition writes Status again.
- A repository owned by an organization is the upgrade path: issue types become the kind marker, the Project can be organization-owned, and GitHub sends webhooks for organization Projects.
