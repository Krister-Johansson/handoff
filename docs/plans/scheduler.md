# Scheduler: start runs from the Ready backlog

## Context

Today a person starts every run. On a planned project that means calling `start_run` (or pressing Start run on the Plan page) for each Ready task, waiting for its pull request to merge, and then starting the tasks that merge unblocked. Issue #403 asks for handoff to work through a planned project on its own: per project, on or off, with a limit of N concurrent runs, starting Ready tasks with no open blockers in Project order, checking again when a merge closes a task, and stopping while the project needs a person.

`docs/plans/run-feedback.md` listed "a scheduler that starts runs on its own" as a non-goal. This plan reverses that non-goal at the user's request. It builds on `docs/plans/project-management.md` (the plan on GitHub Projects, the Ready gate, status writes, blockers, rate limits), `docs/plans/stacked-prs.md` (the merge queue) and `docs/plans/sidebar.md` (the project Overview).

The test case is todooverkill (project id `6c588fd7-a382-4b79-b10b-695212d490e2`, repository `Krister-Johansson/todoOverKill`), whose plan is GitHub Project #5 "todooverkill plan": 5 epics, 16 stories and 39 tasks, linked with blocked-by relations.

The scheduler works the same in a Flow project ([`docs/plans/flow.md`](flow.md)). A Flow project uses neither dates nor Arrange by estimate; its plan is the order of its tasks and their blockers. The scheduler reads Project order in both plan modes and does not read pins. In a Flow project handoff also writes Project order, which no code did when this plan was written: a drag on the Flow, Optimize, `set_order` and a split plan's new parts move items with `updateProjectV2ItemPosition`.

Read `CLAUDE.md`, `GLOSSARY.md`, `docs/plan.md` and the three plans above first.

## Goals

- A scheduler per project, off by default, with a limit of N active runs.
- Each check starts runs on Ready tasks that have no open blockers and no active run, in Project order or by a Priority field, until N runs are active.
- A merge that closes a task makes handoff check again at once, so tasks whose last blocker closed start without waiting for the periodic check.
- Only tasks in Ready are eligible. Shaping, epics, stories and issues outside the plan never start on their own.
- The scheduler starts nothing while the project has a failed run, an open question, a review waiting or a pending permission request, and it resumes on its own when they clear.
- A run the scheduler started does not code over files an active run owns.
- Start, pause and status over MCP and on the dashboard. Every run the scheduler starts says so.

## Non-goals

- Changing the Claude cap. `HANDOFF_CAP_CLI` stays the worker's setting; the scheduler limits runs, not Claude processes.
- Requesting merges. A manual merge queue still waits for a person; the scheduler never calls `request_merge`.
- Moving tasks to Ready. Shaping and the decision to release a task stay with a person.
- Projects without a plan. Without a GitHub Project there is no Ready gate, so the scheduler refuses to turn on.
- Predicting a task's files from its issue text before it has a plan.
- Retrying failed runs, repairing them or answering their questions.
- A schedule across projects. Each project has its own scheduler and limit; the worker's caps are shared as today.

## Verified facts

Read on `main` at commit `22ec4bb` on 2026-10-02, with read-only `gh` calls and read-only handoff MCP tools for the live facts.

### How a run starts

- `startRunFromGraph` lives in the dashboard, `apps/web/src/server/graphs.ts:160-182`. It loads the graph's latest version (`:169`), reads each issue with its lineage through `linkIssues` (`:172`, `:215-231`), applies the Ready gate through `refuseUnready` unless `again` is set (`:174`, `:190-202`), refuses blocked issues through `refuseBlocked` (`:175`, `:205-209`, which calls `github.openBlockers` per issue), calls `createRun` (`:178`) and writes Running on the plan with `recordPlanStatus` (`:180`).
- `refuseUnready` reads the whole Project with `plan.listItems` (`graphs.ts:191`) and refuses an epic, a story or a task whose Status is not Ready. Issues outside the Project start as before (`:194`).
- `startRunFromGraph` does not check whether another active run already links the issue. Nothing in `createRun` (`packages/engine/src/runs.ts:15-52`) does either. Two calls on the same issue create two runs.
- `runAgain` calls `startRunFromGraph` with `again: true` and no GitHub port (`graphs.ts:249`), so it skips both the Ready gate and the blocker check.
- `createRun` inserts the run as `queued` with a pending execution for the start node and appends `run.created` with the task, graph version, branch and issue numbers (`runs.ts:24-49`). It records nothing about who started the run. The `runs` table has no starter column (`packages/db/src/schema/runs.ts:7-42`).
- The MCP tool `start_run` (`apps/web/src/server/agent-mcp.ts:175-182`) picks the graph from `graph` or the project's default graph and calls `startRunFromGraph`. The catalog entry is `confirm: true, openWorld: true` (`apps/web/src/lib/assistant/catalog.ts:103-118`). The default graph is the graph the latest run used, else the graph changed last (`graphs.ts:76-78`); no column stores it.
- The start node waits while a linked issue has an open blocker, on wait key `deps:<projectId>` with a 5 minute recheck (`packages/engine/src/executors/flow.ts:18-29`). A run that passed `refuseBlocked` does not normally reach this wait.

### The backlog and the Ready gate

- `listBacklog(db, github, projectId, plan)` (`apps/web/src/server/backlog.ts:38-66`) reads `github.listIssues`, the latest run per issue (`latestRuns`, `:16-27`) and, with a plan, `plan.listItems`. With a plan it keeps planned tasks in Ready that are to do, plus unplanned issues (`:60`). It orders startable issues first, then blocked ones, each in GitHub's order, most recently updated first (`:61-63`). `listBacklogOnce` caches it per request with React's `cache` (`:30`).
- `isTodo` is "no run, or the latest run is cancelled" (`backlog.ts:13`).
- `github.listIssues` reads the first 100 open issues ordered by `UPDATED_AT DESC` with their blockers (`packages/github/src/octokit-client.ts:46`, `:118-132`). `openBlockers` reads one issue's open blockers (`:134-138`).
- The backlog's order is not the Project's order. Nothing in handoff orders tasks by their position in the Project.

### What happens after a merge

- The merge node (`packages/engine/src/executors/github.ts:332-401`) waits on `deps:<projectId>` while a linked issue is blocked (`:343-351`), joins the project's merge queue and waits on `mq:<projectId>` for its turn (`:352-365`). Mode is `auto` only when the node's config says so, else `manual` (`:341`); the dashboard reads the same from the graph (`apps/web/src/server/merge-queue.ts:8`).
- After `mergePr` succeeds it notifies, calls `closeLinkedIssues` (`:390`, defined at `:292-306`, which closes each still-open linked issue with a comment), writes Done on the plan with `movePlan` (`:392`) and wakes `deps:<projectId>` with `wakeDependents` (`:394`, `packages/engine/src/dependencies.ts:4-9`).
- A pull request a person merged on GitHub before the merge node's turn completes through `snapshot.merged` (`github.ts:372`) without `closeLinkedIssues`, without Done and without `wakeDependents`.
- The PR node writes In review the first time it records a pull request (`github.ts:214`). Status writes never fail a step; they become `plan.skipped` (`packages/engine/src/plan-status.ts:17-38`).
- `wakeDependents` only wakes executions waiting on `deps:<projectId>`. Nothing starts a new run when an issue closes.
- `cancelRun` (`packages/engine/src/operations.ts:57-76`) cancels a run, including a failed one (`:62`), and writes Ready back for the issues no newer run links (`:75`). A cancelled task is back in the backlog.

### Where a periodic loop could live

- The worker's engine loop is `startWorker` (`packages/engine/src/scheduler/worker.ts:123-181`): it polls for pending executions every second (`apps/worker/src/app.ts:108`, `pollIntervalMs: 1000`), keeps at most four executions in flight (`maxInFlight: 4`), and beats the worker row every 15 seconds (`worker.ts:131`). It has no project-level loop and no other timer.
- The worker builds a `ProjectsPort` from `GITHUB_TOKEN` only, checked once at start by `planAccess` (`apps/worker/src/app.ts:93`, `apps/worker/src/plan-status.ts`). With a GitHub App alone the worker has no Projects access.
- The dashboard has no server-side loop: there is no `apps/web/src/instrumentation.ts`, and no `setInterval` under `apps/web/src/server`. The Plan page refreshes from the browser every 30 seconds while visible (`docs/plans/project-management.md`, Decision 4).
- Waits and wakes are rows: `wakeByKey` sets a waiting execution to pending (`packages/db/src/ops/claim.ts:84-99`), and `reapExpiredWaits` wakes deadlines. No code uses Postgres LISTEN or NOTIFY for the engine.

### The Claude cap and the run count

- `HANDOFF_CAP_CLI` defaults to 1 (`apps/worker/src/env.ts:14`); the caps are `cli`, `shell`, `github`, `human` (1000) and `function` (`env.ts:60`).
- `claimNext` counts executions with status `running` per executor kind and claims only kinds with room, oldest `runnable_at` first (`packages/db/src/ops/claim.ts:16-59`). The cap holds across workers through an advisory lock (`:9`, `:21`).
- A waiting execution (PR, merge queue, human gate, timer) does not count against any cap; it holds no process. The worker records its caps in the `workers` row (`packages/db/src/schema/workers.ts:7`).
- A run's status is `queued`, `running`, `waiting`, `succeeded`, `failed` or `cancelled` (`packages/db/src/schema/enums.ts:3`). `listProjects` counts active runs as `queued`, `running` and `waiting` (`apps/web/src/server/graphs.ts:31`).
- So N runs and the Claude cap are separate: with N = 3 and the cap at 1, three runs exist, and their Claude steps take turns.

### What needs a person, per project

- `listAttention` (`apps/web/src/server/attention.ts:75-101`) is global: open questions, failed runs, pull requests waiting for review, stuck loops and finished runs. Its items carry a `href` but no project id (`apps/web/src/lib/attention.ts:2`).
- `inboxGroups` (`apps/web/src/server/inbox-groups.ts:28-58`) is also global and adds pending permission requests and pull requests ready to merge (`readyToMerge`, `:9-21`). It splits questions into reviews (questions whose context has `review`) and other questions (`:37-40`). `list_inbox` narrows it to one project after the fact (`agent-mcp.ts:229-233`).
- `projectAttention` (`apps/web/src/server/project-admin.ts:105-158`) counts per project: open questions (reviews included), failed runs, pull requests waiting for review, pull requests waiting for CI and queued or running runs. It has no permission requests.
- A failed run stays `failed` until it is repaired or cancelled (`apps/web/src/server/inbox.ts:40-47`, `attention.ts:62-64`: only finished items can be dismissed). A loop that ran out of rounds is a failed run with reason `loop_exhausted` (`attention.ts:44-54`).
- All of this lives in `apps/web`. The worker cannot import it.

### What overlap data exists

- A run has owned paths only after its planner passes: `state.plan.ownedPaths` (`packages/core/src/schema/run-state.ts:47`). The context packet and `diff_within_paths` read it (`packages/engine/src/context.ts:129`, `packages/engine/src/contract/checks.ts:162`).
- Before the planner, a run has its task text and linked issues only. An issue has no list of files.
- Nothing compares owned paths between runs. Decision 10 of `docs/plans/run-feedback.md` (the planner's context lists other active runs' owned paths; the plan gate shows overlaps) is not built: no code under `packages/engine/src`, `packages/core/src` or `apps/web/src/server` mentions overlap or other runs' paths.
- The coder's first attempt is a known point after the plan: the worker fast-forwards the worktree there (`worker.ts:294`, `if (node.type === "coder" && row.attempt === 1)`).

### The Projects port, order and priority

- `listItems` (`packages/github/src/projects/octokit-projects.ts:97-100`) pages `PlanItems` with `items(first: 100, after: $cursor)` (`packages/github/src/queries/plan-items.graphql:4`) and keeps the order GitHub returns. `ProjectV2.items` defaults to `orderBy: {field: POSITION, direction: ASC}` (`packages/github/src/schema/schema.docs.graphql:40965`), the item's position in the Project. So `listItems` already returns Project order.
- `PlanItem` (`packages/github/src/projects/types.ts:8-39`) has number, title, state, kind, status, parent, labels, assignees, sub-issue counts, open blockers (`blockedBy`, from `blockedBy(first: 20)`), linked pull requests, dates and iteration. It has no position and no priority. The query reads fields by name with `fieldValueByName` (`plan-items.graphql:10`); no field named Priority is read.
- Live, Project #5 has the fields Title, Assignees, Status (Shaping, Ready, Running, In review, Done), Labels, Linked pull requests, Milestone, Repository, Reviewers, Parent issue, Sub-issues progress, Created, Updated and Closed. It has no Priority field and no Start or Target fields. Its one view, "View 1", is a table with no sort. The user's Projects #2 and #3 have a single select Priority (`docs/plans/project-management.md`, Verified facts).

### The todooverkill plan, live

- Project #5 holds 60 issue items: 5 epics, 16 stories and 39 tasks. All 60 are in Shaping. None is in Ready, so the Ready gate admits no task today.
- In Project order the tasks are #141 to #151 (R1 to R11), then #78, #79, #117, #82, #83, #16, #88, #29, #28, #66, #67, #71, #115, #65, #32, #33, #40, #110, #41, #42, #43, #44, #45, #47, #48, #46, #49, #152.
- Tasks without an open blocker: #141, #66, #67, #71, #115, #65, #32 and #152. #16 is blocked by the open #145 (its other blockers, #8 and #15, are closed). The chain the issue names: #142 is blocked by #141; #143, #144 and #149 by #142; #145 to #148, #150 and #151 by #143 (or #142 for #149).
- #46 "Screen reader pass (human task)" carries the label `human`.
- One run is active: `64fde8ef` on #16, waiting at `human_gate-1` with the review "Review the plan from planner-1" since 2026-10-02 14:22 UTC. No run is failed. `list_inbox` for todooverkill lists that one review and nothing else.
- `list_plan` for todooverkill through the running dashboard fails with "GitHub Project #5 of Krister-Johansson does not exist or GITHUB_TOKEN cannot see it.", while `gh` with the Krister-Johansson token reads it.

### Rate cost of reading the plan

- The `PlanItems` query on Project #5 (60 items, one page) reported `rateLimit { cost: 4 }` on 2026-10-02, the same 4 points per 100-item page that `docs/plans/project-management.md` measured. A query of the Project's fields and views cost 1 point.
- GraphQL allows 5,000 points per hour per user, shared by the dashboard and the worker (`docs/plans/project-management.md`, Rate limits).

### Adding a tool and a setting

- `CATALOG` in `apps/web/src/lib/assistant/catalog.ts:45` is the one list of tools; a `ToolSpec` has `name`, `title`, `description`, a Zod `input`, `kind`, `confirm`, `readOnly`, optional hints and `summarize` (`:9-27`). Data tools get their handler in `handlersFor` in `apps/web/src/server/agent-mcp.ts:114`, and `registerDataTools` registers every catalog data tool that has a handler for the plugin, the assistant and WebMCP (`:411-424`). The plugin needs no code change for a new tool.
- Project settings (`apps/web/src/app/projects/[projectId]/settings/page.tsx:19`) shows the default graph and the default library. Repository, branch, setup command and plan link are in Settings, Projects (`apps/web/src/components/settings/projects-settings.tsx`). Server actions for project pages live in `apps/web/src/app/projects/actions.ts`, for example `moveToReadyAction` (`:247`).
- The project Overview does not exist yet: `/projects/<id>` redirects to Runs (`apps/web/src/app/projects/[projectId]/page.tsx:9-18`). It is step 3 of `docs/plans/sidebar.md`, after the user approves its design.
- Run events belong to a run: `events.run_id` is not null (`packages/db/src/schema/events.ts:10-12`). There is no table for project-level events.

## Unverified

- How soon after `closeIssue` GitHub's `blockedBy` on a dependent issue reports the blocker as closed. The scheduler reads blockers on its next check; if the read is stale it starts the task on a later check.
- Whether `fieldValueByName(name: "Priority")` costs no points, as the query's comment says for the other fields. PR 2 measures it with `rateLimit { cost }`.
- The merge mode of todooverkill's `master` graph (manual or auto). The verification steps cover both.
- Why the running dashboard cannot see Project #5. The likely cause is a `GITHUB_TOKEN` in the dashboard's environment without the `project` scope or from another account; the verification starts by fixing it.
- Whether a person reorders items on GitHub's board in a way that changes `POSITION`. The docs do not say which views write position. PR 2 records it by moving an item in the table view and reading the order again.

## Decisions

Decision 5 and open question 2 changed on 2026-10-02 at the user's request (#452): only failed runs and pending permission requests hold new starts.

### 1. The scheduler runs in the worker

A new loop in the worker process, next to `startWorker`, checks projects whose scheduler is on. The shared start logic moves out of the dashboard into `packages/engine/src/start-run.ts`, so the dashboard's `start_run` and the scheduler call the same function.

Why the worker: it is the process that is always on while runs exist, it already polls Postgres every second, and it holds the GitHub and Projects ports. The dashboard has no server-side loop and is not guaranteed to run; a Next.js dev server restarts on edits. A graph node per project was considered and rejected: runs are per task, and a run that starts runs would need cancel and repair to cascade.

Consequence: the scheduler needs the worker's Projects access (a classic `GITHUB_TOKEN` with `project`). Without it the worker logs once that the scheduler is off and why, and `get_scheduler` reports it.

### 2. When it checks: a due time per project, nudged by events

Each project's scheduler row has `next_check_at`. The worker looks for due rows every 5 seconds, claims one with a lease (so two workers never check the same project at once), runs one check, and sets `next_check_at` to 60 seconds later.

Events that can make a task startable or clear a hold bring the check forward by setting `next_check_at` to now: a run ends (succeeded, failed or cancelled), a merge closes issues, a question is answered, a permission is decided, a run is repaired, a stuck loop is resolved, a task moves to Ready through handoff, and the scheduler is turned on, resumed or changed. A nudge never schedules a check closer than 10 seconds after the last one, so a burst of events costs one check.

The 60 second check catches what has no event: a person moving a card to Ready on GitHub's board (user Projects have no webhooks) and an issue closed by hand.

A check that cannot start anything (a hold, or N runs already active) reads nothing from GitHub. Only a check with a free slot reads the Project once, 4 points for up to 100 items. At one read a minute that is at most 240 points an hour of the 5,000.

### 3. Which tasks, in which order

A candidate is a Project item that is a task (kind `task`), in Ready, open, with no open blockers, with no active run linking it, and whose latest run, if any, was not cancelled. Epics, stories, Shaping tasks and issues outside the Project are never candidates.

Order: Project order by default, the position `listItems` already returns. With `order: priority`, the single select field named "Priority" orders first (the field's first option is the highest; items without a value come after every item with one), and Project order breaks ties. When the Project has no Priority field, the setting is refused with that sentence.

A task whose latest run was cancelled is skipped with the reason "cancelled run; start it by hand". `cancelRun` writes Ready back (`operations.ts:75`), so without this rule the scheduler would restart a task a person had just stopped.

### 4. N counts active runs, whoever started them

N is the number of the project's runs in `queued`, `running` or `waiting`, including runs a person started and runs waiting in the merge queue or at a gate. Each check starts at most `N - active` runs, one candidate at a time in order, re-reading the run count in the same transaction as the insert.

The start goes through the shared start function with `startedBy: "scheduler"` and the Project items the check already read, so the Ready gate does not read the Project a second time. A start that is refused (a blocker GitHub now reports, a run that took the task in the meantime) is skipped for this check with an event, and the next candidate is tried.

The shared start function gains a refusal for an issue an active run already links, under a per-project advisory lock (`pg_advisory_xact_lock(hashtext('handoff.start:' || project_id))`) taken in the transaction that inserts the run. This closes the race between a person's `start_run` and the scheduler, and makes `start_run` refuse a second run on a taken issue, which today it allows.

The scheduler uses one graph, stored on its settings, defaulting to the project's default graph when it is turned on. A run someone starts with a test graph does not change what the scheduler runs.

### 5. Stop rules, and how a person resumes

Before it starts anything, a check computes the project's holds from Postgres:

- a failed run, including a loop that ran out of rounds;
- a pending permission request.

Any hold stops new starts. Holds count every run of the project, whoever started it, and failed runs from before the scheduler was turned on.

A run waiting on a person for anything else is not a hold: an open question, a review gate's question (plan review, code review, Try it), a pull request whose PR node waits for an approving review, and a pull request waiting in a manual merge queue for a person to merge it. Such a run stays active and counts toward N. With N = 1 nothing new starts while it waits; with a higher N the other slots keep working.

Holds clear on their own. The action that clears one (a repair, a cancel, a permission decision) nudges the scheduler, and the next check starts runs again. Nothing else is needed from the person.

A person can also pause the scheduler (`pause_scheduler`, or Pause on the dashboard). A pause stops new starts until the person resumes (`start_scheduler`, or Start). Pausing never touches active runs.

The scheduler pauses itself, with the reason, after three failed starts in a row (an error that is not a refusal of one task, such as a missing graph or GitHub refusing every call). That pause also needs a person to resume.

### 6. Overlap: one run planning at a time, then a hold before the coder

Before its planner passes, a run has no owned paths, and a candidate task never has a plan before it starts. So overlap cannot be judged before a start from paths, and this plan does not guess paths from issue text.

Two rules instead:

1. The scheduler does not start a run while a run it started has no plan yet (`state.plan` unset and the run active). Each new run's planner finishes before the next one starts, so every active run but the newest has known paths.
2. Before the coder's first attempt of a run the scheduler started, the worker compares the run's `ownedPaths` with the `ownedPaths` of every other active run of the project. A directory owns the files under it, a file owns itself, and package manager files count as one unit as in `diff_within_paths`. On an overlap the execution yields a timer wait on key `overlap:<projectId>` with a 10 minute recheck and the event `run.overlap_held` naming the other run and the shared paths. The wake points of Decision 2 (a run ends, a merge closes issues) also wake `overlap:<projectId>`. When no overlap remains, the coder starts, and the existing fast-forward moves the worktree to the latest base.

A held run holds no Claude slot, because a waiting execution does not count against a cap. It still counts toward N.

Runs a person started are not held. Their plan gate is where a person sees overlaps, once Decision 10 of `docs/plans/run-feedback.md` is built.

### 7. The Claude cap stays separate

N limits runs. `HANDOFF_CAP_CLI` limits Claude processes across all projects, and the scheduler never changes it. With N above the cap, runs take turns at their Claude steps in `claimNext` order while their other steps (CI waits, gates, the merge queue) proceed. `get_scheduler` and the dashboard show both numbers from the worker's caps, as "2 of 3 runs active, 1 Claude slot", so a person sees why a run sits queued.

### 8. The merge queue is unchanged

The scheduler never requests a merge and never reorders the queue. In manual mode a run waits at the head of the queue for a person, as today, and counts toward N. In auto mode it merges on its own.

The merge node's success path already closes the issues, writes Done and wakes `deps:<projectId>`; it also nudges the scheduler. A run that ends because a person merged its pull request on GitHub (`github.ts:372`) nudges the scheduler through the run's end, and the next check reads the closed issue from the Project.

### 9. What it records

Project-level events go to a new table `scheduler_events` (project id, type, payload, time), since run events need a run. Types:

- `scheduler.started` and `scheduler.paused` with who and why (a person, or the scheduler itself after failed starts), `scheduler.resumed`, `scheduler.changed` with the old and new settings;
- `scheduler.held` with the reasons and the runs or questions behind them, written only when the set of reasons changes;
- `scheduler.idle` with the reason (no Ready task, all candidates blocked, a run still planning), written only on change;
- `scheduler.run_started` with the run id, the issue and its place in the order;
- `scheduler.skipped` with the issue and the refusal, once per issue and reason;
- `scheduler.start_failed` with the error.

The run gets its own record: `run.created` carries `startedBy`, and the run's first event after it is `run.scheduled` with the place in the order and the scheduler's settings at that moment. `run.overlap_held` is a run event.

### 10. A scheduler-started run says so

A new column `runs.started_by` holds who started the run: `scheduler`, `dashboard`, `claude-code`, `assistant` or `cli`. Existing rows keep null, shown as nothing. The Runs table, the run page header, `list_runs` and `get_run` show "Scheduler" for the scheduler's runs. The overlap hold reads this column.

### 11. Settings are a row per project

A table `project_schedulers` keyed by project id holds the settings and the loop's state: `enabled`, `max_runs` (1 to 10), `order` (`project` or `priority`), `graph_name`, `paused_at`, `paused_by`, `pause_reason`, `next_check_at`, `last_check_at`, `lease_owner`, `lease_expires_at`, `start_failures` and `last_result` (the last check's state, holds and next candidates, for the status reads). A row exists once someone turns the scheduler on. Turning it on refuses a project without a plan number, a demo project and a project without the chosen graph.

## Design

### Data model

Migration with `pnpm db:generate`, reviewed and committed:

- `runs.started_by text null`.
- `project_schedulers`: `project_id uuid primary key references projects`, `enabled boolean not null default false`, `max_runs integer not null default 1` with a check of 1 to 10, `order text not null default 'project'` with a check, `graph_name text not null`, `paused_at timestamptz`, `paused_by text`, `pause_reason text`, `next_check_at timestamptz not null default now()`, `last_check_at timestamptz`, `lease_owner text`, `lease_expires_at timestamptz`, `start_failures integer not null default 0`, `last_result jsonb`, `created_at`, `updated_at`. A partial index on `next_check_at` where `enabled and paused_at is null`.
- `scheduler_events`: `id bigint identity`, `project_id uuid not null references projects`, `type text not null`, `payload jsonb not null`, `created_at`. An index on `(project_id, created_at desc)`.

### Engine

```
packages/engine/src/
  start-run.ts                 startRun(db, input, ports): the body of startRunFromGraph, plus refuseTaken and startedBy
  backlog-scheduler/
    candidates.ts              candidates(items, latestRuns, opts): ordered list with skip reasons; pure
    holds.ts                   projectHolds(db, projectId): failed runs, stuck loops, pending permissions
    overlap.ts                 overlaps(paths, others): shared paths; pure
    tick.ts                    checkProject(deps, projectId): holds, count, one Project read, starts, events, last_result
    nudge.ts                   nudgeScheduler(db | tx, projectId); schedulerKey and overlapKey
    loop.ts                    startBacklogScheduler(deps, { pollMs }): claims due rows with a lease and checks them
```

- `startRun` takes `{ projectId, graphName, task, issues, again?, startedBy, items? }` and `{ github, projects }`. With `items` it applies the Ready gate to them instead of reading the Project. `refuseTaken` runs inside the insert transaction under the per-project advisory lock. `apps/web/src/server/graphs.ts` keeps `startRunFromGraph` as a thin call with the caller's `startedBy`.
- `projectHolds` moves the per-project counting into the engine, so the worker and the dashboard share it. `listAttention`, `inboxGroups` and `projectAttention` stay as they are; the dashboard's scheduler card calls `projectHolds`.
- `checkProject` order of work: read the row (skip when off or paused); `projectHolds`; count active runs; stop when a run the scheduler started has no plan; read `projects.listItems` once; `candidates`; for each start until full, `startRun` with `startedBy: "scheduler"` and the items; write events only when the result changed; set `last_result`, `last_check_at`, `next_check_at`.
- Nudges are one `update project_schedulers set next_check_at = greatest(now(), last_check_at + interval '10 seconds') where project_id = $1 and enabled`, inside the caller's transaction where there is one: `finishRouting` in `scheduler/complete.ts` when a run ends, `cancelRun`, `answerQuestion`, `decidePermission`, `repairNodeExecution` and `resolveExhaustedLoop` in `operations.ts`, the merge node next to `wakeDependents`, and `moveToReady` in `apps/web/src/server/shaping.ts`. The same places that end a run or merge wake `overlap:<projectId>`.
- The overlap hold sits in `executeClaimed` (`scheduler/worker.ts`) before the workdir is acquired, for `node.type === "coder"`, `row.attempt === 1` and `run.startedBy === "scheduler"`. It yields through the existing `yieldWaiting`.

### Worker

`apps/worker/src/app.ts` starts `startBacklogScheduler` after `startWorker` when `projects` is defined, with `pollMs: 5000`, and stops it on shutdown. Without Projects access it logs "The scheduler is off: ..." once, with the same fix sentence as `planAccess`.

### Web and MCP

`apps/web/src/server/scheduler.ts`: `getScheduler(db, projectId)` (settings, state, holds with links, active runs, Claude slots from the newest live worker row, next three candidates from `last_result`, the last 20 events), `startScheduler(db, projectId, settings, actor)`, `pauseScheduler(db, projectId, actor, reason)`.

Catalog tools, all with `project`:

| Tool | Kind | What it does |
|---|---|---|
| `get_scheduler({ project })` | read, untrusted | On, off or paused; held with reasons and their links; idle with the reason; active runs of N; Claude slots; the next candidates in order with each skipped task's reason; recent scheduler events; the dashboard link. |
| `start_scheduler({ project, max_runs?, order?, graph? })` | confirm, openWorld | Turns the scheduler on, or resumes it, and changes the settings given. Refuses a project without a plan (naming `setup_plan`), a demo project, a graph that does not exist, priority order without a Priority field, and a worker without Projects access. The approval card says "Let handoff start up to 2 runs at a time on Ready tasks in todooverkill, in Project order, with graph master". |
| `pause_scheduler({ project, reason? })` | write, not confirm, idempotent | Stops new starts until resumed; active runs go on. |

The server instructions in `agent-mcp.ts` gain one line: the scheduler starts runs on Ready tasks on its own once a person turns it on; a person decides what is Ready. The `handoff` skill gains a short section with the same rule and the three tools; the plugin version goes up.

### Dashboard

Written for a designer; components are shadcn on Tailwind like the rest of the dashboard.

- Scheduler card. On the Plan page, a full-width card above the Tree, Board and Timeline control; on the project Overview, the same card once the Overview exists (`docs/plans/sidebar.md`, step 3). Header: "Scheduler", a state badge (Off, Running, Held, Idle, Paused) and on the right "Start" or "Pause". Body: "2 of 3 runs active, 1 Claude slot" with links to the active runs; when held, one line per reason with its link ("Run 64fde8ef waits for your plan review", to the review page; "Run 1a2b3c4d failed at coder-1", to the run page); when idle, the reason ("No task is Ready. Move shaped tasks to Ready on the Plan."); "Next up" with the first three candidates (number, title) and a "Skipped" disclosure listing skipped Ready tasks with their reasons; a footer with "Checked 12 s ago" and the last five events, with "All events" opening a sheet with 50. Start opens a confirm dialog that repeats the approval card's sentence.
- Plan page rows: a Ready task that is a candidate shows a small "Next 1", "Next 2" tag; a skipped one shows its reason in the hover card.
- Project settings: a "Scheduler" section card with an on and off switch, "At most [n] runs at a time" (1 to 10), "Order" (Project order, or Priority field, disabled with the reason when the Project has none), "Graph" (the project's graphs), and a line saying the worker's Claude cap. Saving calls a server action through `startScheduler` or `pauseScheduler`.
- Settings, Projects: each project row shows "Scheduler on, 2 of 3" or nothing.
- Runs table and run page: a "Scheduler" tag next to the task for runs with `started_by = 'scheduler'`; the run page's event list summarizes `run.scheduled` and `run.overlap_held` ("Waiting: shares app/board with run 1a2b3c4d").
- Accessibility: the state badge carries text; Start and Pause are buttons with the project in their accessible name; the event list is a list with times as `<time>`.

## Delivery

Each PR is one GitHub issue, one branch, CI green, a red-green slice per test named here, `pnpm doctor:react` clean after changes under `apps/web`, and Context7 before code against Drizzle, Next.js, Zod, Octokit or Vitest. PRs 1 and 2 are independent; 3 needs 1 and 2; 4 needs 3; 5 needs 1 and 4; 6 needs 3; 7 needs 6; 8 needs 7.

1. **Shared start, refusal of taken issues, and attribution.** Files: `packages/engine/src/start-run.ts`, `packages/engine/package.json` export, `apps/web/src/server/graphs.ts`, `apps/web/src/server/agent-mcp.ts` (`startedBy` from `actor`), `apps/web/src/app/projects/actions.ts`, `packages/db/src/schema/runs.ts` and a migration, `packages/engine/src/runs.ts` (`run.created` payload), `apps/web/src/components/projects/runs-table.tsx`. First tests: `packages/engine/src/start-run.integration.test.ts` "startRun refuses an issue that an active run links and names the run"; "two concurrent starts on one issue create one run"; "startRun records startedBy on the run and in run.created"; "startRun with the Project items already read applies the Ready gate without reading the Project again". `apps/web/src/server/agent-mcp.integration.test.ts` addition "start_run records claude-code as the starter". `runs-table.test.tsx` addition "a run the scheduler started carries the Scheduler tag".

2. **Port: Project order and Priority.** Files: `packages/github/src/queries/plan-items.graphql` (Priority by name), `plan-project.graphql` (the Priority field's options), `projects/types.ts` (`position`, `priority`), `projects/octokit-projects.ts`, `testing/fake-projects.ts`. First tests: `projects/octokit-projects.test.ts` additions "listItems numbers items by their position across pages"; "listItems reads the Priority option and getProject returns the Priority options in field order"; "a Project without a Priority field gives every item no priority". Manual step recorded on the PR: the `rateLimit { cost }` of the query with Priority, and whether moving an item in the table view changes its position.

3. **Scheduler core.** Files: the two tables and a migration, `packages/engine/src/backlog-scheduler/{candidates,holds,tick,nudge}.ts`. First tests: `candidates.test.ts` (pure) "only open Ready tasks without open blockers and without an active run are candidates, in Project order"; "epics, stories, Shaping tasks and unplanned issues are never candidates"; "priority order puts the first option first, items without a value last, and keeps Project order within a priority"; "a task whose latest run was cancelled is skipped with the reason". `holds.integration.test.ts` "a failed run, a loop out of rounds and a pending permission each hold the project"; "an open question, a plan or code review, Try it and a pull request waiting for review do not hold"; "a pull request waiting in a manual merge queue does not hold"; "holds count runs a person started". `tick.integration.test.ts` (real Postgres, `FakeGitHub`, `FakeProjects`) "a check starts runs in order until max_runs runs are active"; "runs a person started count toward max_runs"; "a check with a hold starts nothing and reads nothing from GitHub"; "a check starts no run while a run the scheduler started has no plan"; "a refused start is skipped and the next candidate starts"; "held is recorded once until the reasons change"; "three failed starts in a row pause the scheduler with the reason"; "two checks of one project at once start each task once".

4. **Worker loop and wakes.** Files: `backlog-scheduler/loop.ts`, `apps/worker/src/app.ts`, `scheduler/complete.ts`, `operations.ts`, `executors/github.ts`, `apps/web/src/server/shaping.ts`. First tests: `loop.integration.test.ts` "a project is checked again 60 seconds after its last check"; "a nudge brings the check forward but never closer than 10 seconds after the last"; "a paused or disabled project is never checked". `lifecycle.integration.test.ts` addition "a run that ends nudges its project's scheduler". `merge-queue.integration.test.ts` addition "a merge that closes a task nudges the scheduler, and the next check starts the task whose last blocker it closed". `packages/engine/src/operations.integration.test.ts` (new) "answering a question, deciding a permission, repairing, resolving a loop and cancelling nudge the scheduler". `apps/worker/src/scheduler-access.test.ts` "the worker starts the scheduler only with Projects access and logs why not".

5. **Overlap hold.** Files: `backlog-scheduler/overlap.ts`, `scheduler/worker.ts`, the wake points from PR 4, `lib/event-summary.ts`. First tests: `overlap.test.ts` "a directory owns the files under it, a file owns itself, and package.json owns its lockfile"; `overlap-hold.integration.test.ts` "a scheduler-started run whose plan shares paths with an active run waits before its coder, naming the run and the paths"; "the held run's coder starts when the other run ends"; "a run a person started is not held"; "a held run does not take the Claude slot".

6. **MCP tools.** Files: `apps/web/src/server/scheduler.ts`, `lib/assistant/catalog.ts`, `server/agent-mcp.ts` (handlers and instructions), `plugins/handoff/skills/handoff/SKILL.md`, `plugins/handoff/.claude-plugin/plugin.json`. First tests: `agent-mcp.integration.test.ts` additions "start_scheduler refuses a project without a plan and names setup_plan"; "start_scheduler stores max_runs, order and graph, and resumes a paused scheduler"; "start_scheduler refuses priority order on a Project without a Priority field"; "pause_scheduler stops new starts and leaves active runs alone"; "get_scheduler reports holds with their links, active runs of max_runs, Claude slots and the next candidates with skip reasons". `catalog.test.ts` addition "start_scheduler is confirm and its summary names the project, the limit, the order and the graph". `packages/connector/src/plugin.test.ts` addition "the handoff skill says a person decides what is Ready and names start_scheduler, pause_scheduler and get_scheduler".

7. **Dashboard.** Files: `components/scheduler/{scheduler-card,scheduler-settings,scheduler-events}.tsx`, the Plan page, project settings page, `components/settings/projects-settings.tsx`, `app/projects/actions.ts` (`startSchedulerAction`, `pauseSchedulerAction`), run page header, `lib/event-summary.ts`. First tests (web): `scheduler-card.test.tsx` "Off offers Start behind a confirm dialog with the settings sentence"; "running shows active runs of max_runs and the Claude slots, with Pause"; "held lists each reason with a link to its run or review"; "idle says why and Next up lists the candidates with a Skipped disclosure"; `scheduler-settings.test.tsx` "max runs takes 1 to 10, Priority order is disabled without a Priority field, the graph lists the project's graphs"; `plan-tree.test.tsx` addition "a candidate task shows its Next tag"; `projects-settings.test.tsx` addition "a project with the scheduler on shows its active runs of max_runs".

8. **Docs.** Files: `GLOSSARY.md` ("Scheduler": per project, starts runs on Ready tasks; not the engine's execution scheduling), ADR 0008 "The scheduler starts runs from Ready tasks in the worker", `docs/plan.md` event list, `docs/plans/run-feedback.md` non-goal marked reversed with a link here, `README.md`.

## Risks

| Risk | Mitigation |
|---|---|
| The scheduler restarts a task a person cancelled, because cancel writes Ready back | A task whose latest run was cancelled is skipped until a person starts it (Decision 3). |
| A person's `start_run` and the scheduler start the same task | `refuseTaken` under a per-project advisory lock in the insert transaction (Decision 4). |
| A failed run from weeks ago holds the project forever | The card and `get_scheduler` name the failed run with its link; cancelling or repairing it clears the hold. Recorded as open question 4. |
| Runs waiting on reviews fill every slot, so nothing new starts until a person answers | A waiting run counts toward N and the card lists it among the active runs; a person raises N or answers the reviews. |
| Two runs edit the same files | One run planning at a time, then the overlap hold before the coder (Decision 6). |
| A planner's owned paths are too wide (`apps/web`), so runs hold each other for long | The hold names the paths; a person can cancel or narrow; the planner budget in `docs/plans/run-feedback.md` Decision 10 keeps plans small. |
| GitHub rate limit shared with the Plan page and runs | A check reads the Project only with a free slot and no hold, at most once a minute plus nudges spaced by 10 seconds; 4 points per read. |
| Blocker state lags after a merge | The next 60 second check reads it again; the nudge after a merge is one of several chances. |
| A person moves tasks to Ready on GitHub and nothing starts for up to a minute | Stated on the card ("Checked n s ago"); moving through handoff nudges at once. |
| The worker has only a GitHub App, so no Projects access | The scheduler cannot turn on; `start_scheduler` and the card say why, with the fix. |
| `tsx watch` restarts the worker on edits during development and a check is cut short | The lease expires and the next worker claims the row; starts are idempotent through `refuseTaken`. |
| N above the Claude cap makes runs slow, not parallel | The card shows both numbers; the default N is 1. |
| A task labelled for a person (todooverkill #46, label `human`) starts as a coding run | Open question 5 recommends skipping such a label. |

## Open questions

Each has a recommended answer; unanswered, the implementation takes the recommendation.

1. Default `max_runs`? Recommended: 1. With `HANDOFF_CAP_CLI=1` and a plan review per run, a higher default mostly adds runs waiting on a person. A person raises it in Project settings.
2. Should a review gate on a run hold new starts? Decided: no. Only failed runs and pending permission requests hold. A run waiting on a question, a plan or code review, Try it or a pull request review stays active and counts toward N, so with todooverkill's `master` graph and N above 1, the other slots keep starting tasks while a plan waits for approval.
3. Should a pull request waiting for a person to merge it (manual merge queue) hold new starts? Recommended: no. It already counts toward N, and holding would stop the project for every ready pull request.
4. Should failed runs from before the scheduler was turned on hold it? Recommended: yes. The card lists them, and one cancel or repair clears each.
5. Should the scheduler skip tasks with a given label? Recommended: yes, a setting "Skip tasks labelled" with `human` as the default, since todooverkill marks #46 "Screen reader pass (human task)" that way.
6. How does a cancelled task get back to the scheduler? Recommended: when a person starts it by hand, or through "Let the scheduler take it" on the task's row in the Plan page, which records `scheduler.released` for that issue.
7. Should runs a person started also wait on overlap? Recommended: no. A person who starts a run chose to; the plan gate shows overlaps once `docs/plans/run-feedback.md` Decision 10 is built.
8. Is the Priority field fixed by name? Recommended: yes, a single select named "Priority", highest first in the field's option order, matching the field on the user's other Projects.
9. Should a self-pause after failed starts send a notification? Recommended: yes, one notification of kind `failed` with the reason and a link to the card. Holds send none, since each hold's cause already notifies.

## Verification

Tests and checks:

```bash
pnpm db:up            # in the main checkout only, never in a worktree
pnpm db:migrate
pnpm --filter @handoff/github codegen
pnpm test
pnpm typecheck && pnpm lint
pnpm doctor:react
```

By hand on todooverkill, with `pnpm dev:web`, `pnpm dev:worker` (from a separate worktree, since `tsx watch` restarts the worker on edits) and `pnpm dev:webhooks Krister-Johansson/todoOverKill`:

1. Fix the dashboard's access first: `list_plan` for todooverkill must return the tree. Today it fails with "GitHub Project #5 of Krister-Johansson does not exist or GITHUB_TOKEN cannot see it."
2. `get_scheduler todooverkill`: expect Off. `start_scheduler` with `max_runs: 2`: expect the approval card naming todooverkill, 2 runs, Project order and graph `master`. Approve. If the plan review of run `64fde8ef` on #16 is still open, expect it not to hold: that run counts as 1 of the 2 active runs.
3. With every task in Shaping, expect Idle, "No task is Ready", and `gh api rate_limit` showing at most one Project read per minute from the worker.
4. Move the tasks of story #125 (#141, #142, #152) to Ready with `move_to_ready`. Expect a check within 10 seconds that starts #141 (first in Project order, no open blocker), with the Scheduler tag, `run.scheduled` and `scheduler.run_started`. Expect #152 not to start while #141's planner runs, and after that only when a slot is free (#16's run also counts toward the 2), and #142 to be listed as skipped, blocked by #141.
5. While #141's plan review waits, expect no hold and the next start when a slot is free. Approve it.
6. Let #141's run open its pull request and merge (request the merge if the queue is manual). Expect #141 closed and Done, a nudge, and #142 started on the next check, since its last blocker closed.
7. Move the tasks of story #126 (#143, #144) to Ready while #142 is open. Expect both skipped, blocked by #142. After #142 merges, expect #143 to start and, with a free slot and #143 planned, #144. If their plans share files, expect the second run to wait before its coder with `run.overlap_held` naming the first run and the paths, and to go on when the first run ends.
8. Fail a run on purpose (repair with a bad setup command, or cancel a CI fix by hand): expect Held naming the failed run, nothing new starting, and the hold clearing after a repair or a cancel. After a cancel, expect that task to be skipped with "cancelled run; start it by hand".
9. `pause_scheduler`: expect Paused, active runs going on, and no start after a merge unblocks a task. `start_scheduler`: expect the start on the next check.
10. Start a run by hand with `start_run` on a task the scheduler lists as next: expect the scheduler to skip it, and a second `start_run` on the same task to be refused, naming the run.
11. Stop the worker for two minutes and start it again: expect the check to run within 5 seconds of the start and no task started twice.
12. Compare `gh api rate_limit` before and after an hour with the scheduler on and nothing Ready: expect at most 240 GraphQL points used by the worker's checks.
