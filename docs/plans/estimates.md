# Timeline estimates and sizes

## Context

Issue #418 asks for an easier way to schedule on the Plan timeline: "it's a bit hard to set a start and end date; can we not say this task is 3h of work, then we can drag it around on the gantt?" On 2026-10-02 the user decided the direction in the issue's comment: agent work is hard to estimate in hours, so a task gets a size first (S, M or L), the timeline turns a size into a bar from this project's finished runs of that size, a manual estimate in hours or days is optional and overrides that forecast, and the forecast is drawn against the actual run strips.

The approved design is the Claude Design file `plan/Timeline estimates.dc.html` with `plan/estimates.css` in the project "handoff dashboard" (`5e1de671-ec5a-48e5-9adc-7afd356df858`), nine frames plus an About section with the decisions, the copy, the open questions, the data gaps and the sample-data notes. Every size, forecast number, sample count, cost, estimate and date in the design is invented (its sample-data notes say so); only the todooverkill issues, titles and blocked-by links are real.

This plan reverses two choices of `docs/plans/project-management.md`: the non-goal "Dragging bars on the dashboard's timeline" with its open question 10 (no drag in v1), and Decision 8's "An Estimate number field with automatic scheduling ... not built now", which becomes size first with an optional estimate. It builds on the timeline that plan delivered (PRs 8 and 9) and on `docs/plans/scheduler.md` (the shared `startRun`).

The Plan toolbar PR, being built now, replaces the timeline label column's blocker chips with a "!" icon and a tooltip. This plan does not touch that, and the design's "Starts before #143 ends" warning goes wherever that PR puts row warnings.

Read `CLAUDE.md`, `GLOSSARY.md`, `docs/plan.md`, `docs/plans/project-management.md` and `docs/plans/scheduler.md` first.

## Goals

- A task has a Size, S, M or L, in a single select field "Size" on the plan's GitHub Project. A person sets it, or the planner proposes one that shows dashed until a person picks a size.
- A size has a forecast from this project's succeeded runs of that size: the median wall time, split into agent, queue and waiting-on-you time, with the cost and the number of runs. Under 5 runs a size uses its default (S 30m, M 1h, L 2h), marked Default.
- A manual estimate, typed as hours or days ("3h", "2d") and stored in hours in a Number field "Estimate", overrides the forecast. 0 means no estimate.
- On the timeline a sized or estimated task's bar runs from its Start for its duration over the project's capacity, one number of hours per day. Every day counts, weekends too, and the time of day does not matter.
- Dragging a bar moves its Start (Target follows); dragging its end sets a manual estimate. Each drop writes to GitHub at once, with a toast and Undo.
- The actual run strip starts under the bar at the bar's scale, so a run past its forecast shows the overrun, and "Over forecast by 50m" replaces "Overdue" while a run is active.
- "Arrange by estimate" places the unscheduled tasks that have a size or an estimate, from today, in blocker order, up to the capacity per day, as a preview first.
- A load row under the dates shows planned hours per day against the capacity.
- The capacity and the forecasts per size are in Settings, Projects. The size and estimate are in `list_plan` and settable over MCP.

## Non-goals

- Capacity per person, working hours, working days and days off. One person works whenever; the design keeps a build note for later.
- Agents running at once adding capacity. Capacity is the person's hours per day.
- Sizes or estimates on epics and stories. They show the sum of their tasks and keep their derived span.
- Moving the tasks a moved task blocks. Blocked tasks stay put; the warning says when a task starts before its blocker ends.
- Re-laying tasks that already have dates in Arrange.
- Dragging on the board or in the tree. The size chip opens the same popover there; dates move on the timeline only.
- Dragging under 640 px. The list form gets a Start field instead.
- A forecast cache table. Forecasts are computed on read from runs, node executions, questions and permission requests.
- Writing a planner's proposal to GitHub on its own. Only a person's pick reaches the Size field.

## Verified facts

Code facts are from `main` at `3fe056c`, read on 2026-10-02. Live facts come from read-only `gh api graphql` calls with the Krister-Johansson token and read-only queries (`begin read only`) on the local `handoff` database, the same day.

### The Projects port and the plan read model

- `PlanItem` (`packages/github/src/projects/types.ts:8-46`) has number, title, url, state, kind, status, parent, labels, assignees, sub-issue counts, open blockers, linked pull requests, `updatedAt`, all blockers, `position`, `priority`, `start`, `target` and `iteration`. It has no size and no estimate.
- `PlanProject` (`types.ts:51-67`) has the Status option ids, `dateFields` (`types.ts:61`, the Start and Target field ids) and `priorityOptions`. `ProjectsPort` (`types.ts:103-148`) has `setDates` (`:140`) and `ensureDateFields` (`:145`). There is no method that writes a number or a single select other than Status.
- `PlanItems` (`packages/github/src/queries/plan-items.graphql:1-102`) reads Status, Start, Target, Priority and Iteration with `fieldValueByName` (`:10`, `:17`, `:23`, `:30`, `:37`). Its comment says values by field name cost no points (`:16`), and a missing Priority answers null without an error (`:29`).
- `field(name:)` lookups on a Project that lacks the field answer NOT_FOUND next to the data. `withOptionalFields` (`packages/github/src/projects/octokit-projects.ts:287-295`) returns the data when every error is a NOT_FOUND on an alias in `OPTIONAL_FIELD_ALIASES` (`:446`, today `start`, `target` and `priority`), through `dataDespiteMissingFields` (`:368-373`). `getProject` and `projectNode` use it (`:76-87`, `:298-307`).
- `issuePlan` (`octokit-projects.ts:309-315`) calls `octokit.graphql` directly, not through `withOptionalFields`, although `IssuePlan` spreads `PlanDateFields` (`packages/github/src/queries/issue-plan.graphql:87`) inside `projectItems`. `getStatus`, `setStatus`, `setDates` and `lineage` all go through `issuePlan`. Live, a `field(name: "Size")` lookup inside `projectItems` on todoOverKill #146 answered NOT_FOUND with the path `repository.issue.projectItems.nodes.0.project.size` next to complete data. So on a Project that lacks a looked-up field, `issuePlan` throws today; adding Size and Estimate lookups to it without the helper would break every status write on Project #5.
- `ensureDateFields` (`octokit-projects.ts:227-239`) creates missing date fields with `createDateField` (`:249-254`, mutation `CreatePlanDateField`, `plan-mutations.graphql:95-105`) and refuses a field of that name with another type. `createProject` creates both date fields (`octokit-projects.ts:174`).
- `setDates` (`octokit-projects.ts:256-269`) reads `issuePlan` once, checks every field first, then sends one `SetPlanDate` or `ClearPlanField` request per date (`plan-mutations.graphql:107-121`).
- `adoptedOptions` (`octokit-projects.ts:338-354`) rewrites the Status field's options keeping every existing option with its `id`, so no item loses its value. The schema says the same of `ProjectV2SingleSelectFieldOptionInput.id`: "Include this to preserve the option's identity during updates, preventing item field values from being cleared." (`packages/github/src/schema/schema.docs.graphql:43215`).
- `FakeProjects` (`packages/github/src/testing/fake-projects.ts`) implements `setDates` (`:184`) and `ensureDateFields` (`:195`) in memory.
- `loadPlan` (`apps/web/src/server/plan.ts:73-138`) reads `getProject`, `listItems`, `github.listIssues`, `latestRuns` and `timelineRuns` (`:141-153`, every run of the project with its issues, status, `startedAt` and `finishedAt`) and returns the tree, the board, unplanned issues and `deriveSpans(...)` (`:137`).

### The timeline

- `deriveSpans` (`apps/web/src/lib/plan/schedule.ts:63-136`) gives each item a planned span from Start and Target (`plannedOf`, `:49-55`), a derived span for epics and stories, actual strips from each run's start to its end or now (`:98-104`), `late`, `overdueDays` (`:117`), `outsideParent` and `unscheduled`, plus arrows. It knows nothing of durations.
- `timeline-scale.ts` has two zooms, `weeks` and `months` (`apps/web/src/lib/plan/timeline-scale.ts:4-5`), 14 px a day (`:7`) and 120 px a month (`:8`). `xAt` places an instant by its local day and time of day (`:21`, `:90-93`). `visibleRange` opens a week before the earliest Start and two weeks after the latest Target, at least eight weeks (`:143-155`). `defaultZoom` picks Weeks under ten weeks (`:158`).
- `plan-timeline.tsx` draws `TaskBar` (`apps/web/src/components/plan/plan-timeline.tsx:172-209`) as a link to the issue with a hatched overdue tail, `Strips` at clock time (`:253-277`), the chart header note "Drag dates on GitHub's roadmap. This timeline shows the Project; it does not move dates." (`:420`), the Unscheduled block with "Schedule" (`:441`) and the `ScheduleDialog` (`:672`). Nothing drags.
- `TimeChips` (`apps/web/src/components/plan/timeline-parts.tsx:50-81`) shows Late, Blocked by, "Overdue by n days" (`:66-71`) and "Outside story window".
- `ScheduleDialog` (`apps/web/src/components/plan/schedule-dialog.tsx:36-103`) saves through `scheduleAction` (`:67`). `scheduleAction` (`apps/web/src/app/projects/actions.ts:313-319`) calls `schedule` in `shaping.ts`, which reads the whole Project with `listItems` and checks the date fields before it writes (`apps/web/src/server/shaping.ts:303-345`, `:312`). `addDateFieldsAction` (`actions.ts:321-326`) backs the banner.
- `parseZoom` accepts only `weeks` and `months` (`apps/web/src/lib/project-tab.ts:36-39`); `go_to_plan` takes `zoom: z.enum(["weeks", "months"])` (`apps/web/src/lib/assistant/catalog.ts:544`).
- `apps/web/package.json` has `sonner` 2.0.8 and `components/ui/sonner.tsx` exists. No drag and drop library is installed.

### Run timing and cost

- `runs` (`packages/db/src/schema/runs.ts:7-44`): `status` (`queued`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`, `packages/db/src/schema/enums.ts:3`), `issues` as `{ number, title, url }[]` (`runs.ts:28`), `startedBy` (`:37`), `startedAt` (`:38`) and `finishedAt` (`:39`). There is no size column.
- A run's `startedAt` is set on its first claim (`packages/engine/src/scheduler/worker.ts:222`) and `finishedAt` when it ends (`packages/engine/src/scheduler/complete.ts:207`); a repair or a resume clears `finishedAt` (`packages/engine/src/operations.ts:45`, `:210`), and `succeeded` is set at `complete.ts:195`.
- `node_executions` (`packages/db/src/schema/node-executions.ts:7-73`): `runnableAt` (`:19`), `costUsd` (`:42`), `claimedAt` (`:51`), `startedAt` (`:52`), `finishedAt` (`:53`). `claimNext` sets `claimedAt` to now on every claim and keeps the first `startedAt` (`packages/db/src/ops/claim.ts:45-56`). Every path back to pending sets `runnable_at = now()`: `wakeByKey` (`claim.ts:89`), `wakeByToken`, the lease reaper and the wait reaper (`claim.ts:102-160`), and `yieldWaiting` (`complete.ts:347`). A retry sets it in the future (`complete.ts:531`). So `claimedAt - runnableAt` measures only an execution's last pending stretch; earlier stretches are lost.
- `yieldWaiting` appends `node.waiting` or `node.woken` with the wait kind (`complete.ts:361-367`).
- `questions` have `createdAt` (`packages/db/src/schema/questions.ts:30`) and `answeredAt` (`:29`); `permission_requests` have `createdAt` (`packages/db/src/schema/permission-requests.ts:31`) and `decidedAt` (`:30`).
- `costUsd` is the cost the Claude CLI reports per step (`packages/engine/src/executors/cli-node.ts:231-236`, `:271`). `apps/web/src/server/home.ts:21` and `run-lines.ts:101` sum it per run or overall. Nothing computes per-size or per-project statistics.
- `startRun` (`packages/engine/src/start-run.ts:50-84`) reads the plan's items for the Ready gate unless the caller passed them or set `again` (`:68-69`), then calls `createRun` (`:79`). `runAgain` passes `again: true` (`apps/web/src/server/graphs.ts:164-182`), so it reads no items.

### The planner

- `PlannerOutputSchema` (`packages/core/src/schema/outputs.ts:14-27`) has `status`, `plan`, `steps`, `ownedPaths`, `acceptance` and `question`. It has no size.
- The planner's validated output becomes `state.plan` (`packages/engine/src/executors/cli-node.ts:282`); `RunStateSchema.plan` keeps `plan`, `steps`, `ownedPaths` and `acceptance` (`packages/core/src/schema/run-state.ts:47`). The planner's instruction is `PROMPTS.planner` (`cli-node.ts:28-32`).
- The planner runs inside a run, and a run starts only on a Ready task (the Ready gate in `start-run.ts:68-69`). A Shaping task has a planner's plan only when an earlier run on it reached its planner. The design shows a proposal on #147, a Shaping task; in the code as it is, that needs a run on #147 that passed its planner.

### Catalog, plugin and settings

- `schedule` (`catalog.ts:451-473`) is confirm, openWorld and idempotent, with items of `issue`, `start` and `target`. `create_task` (`catalog.ts:402-423`) takes `start` and `target`. `list_plan`'s handler (`apps/web/src/server/agent-mcp.ts:330-345`) returns `start` and `target` per item (`:334`). The server instructions name `schedule` (`agent-mcp.ts:35`).
- `plugins/handoff/.claude-plugin/plugin.json` is version `0.5.0`.
- `projects` (`packages/db/src/schema/projects.ts:7-30`) has `planProjectNumber` (`:27`) and no capacity. Settings, Projects shows "Plan on GitHub" with the Project's link and Unlink (`apps/web/src/components/settings/projects-settings.tsx:102-133`, `:154`). Project settings show the default graph and library (`apps/web/src/app/projects/[projectId]/settings/page.tsx:19`).

### GitHub ProjectV2 Number and single select fields

From the vendored schema (`packages/github/src/schema/schema.docs.graphql`) and the GitHub docs through Context7 (`/github/docs`):

- Create: `createProjectV2Field(projectId, dataType, name, singleSelectOptions?)` (`CreateProjectV2FieldInput`, schema `:8992`); `singleSelectOptions` "At least one value is required if data_type is SINGLE_SELECT"; an option is `{ name, color, description, id? }` with `color` and `description` required (`:43215`). `ProjectV2CustomFieldType` includes `NUMBER` and `SINGLE_SELECT` (`docs/plans/project-management.md`, Verified facts).
- Write: `updateProjectV2ItemFieldValue` with `value: { number: Float }` or `{ singleSelectOptionId }` (`ProjectV2FieldValue`, schema `:41696`); the docs say "Only 1 value can be updated at a time". `clearProjectV2ItemFieldValue` clears one (`plan-mutations.graphql:115-121`). GitHub's Actions example in `automating-projects-using-actions.md` sends two aliased `updateProjectV2ItemFieldValue` mutations in one request.
- Read: `ProjectV2ItemFieldNumberValue { number: Float }` (schema `:42120`) and `ProjectV2ItemFieldSingleSelectValue { name, optionId }` (`:42255`); `fieldValueByName(name:)` returns "The field value of the first project field which matches the 'name' argument that is set on the item." (`:41776-41783`).
- Options: "Single select fields can contain up to 50 options." `updateProjectV2Field`'s `singleSelectOptions` "overwrite existing options" (schema `:70721`).

### Rate cost, live

- `PlanItems` on Project #5 (60 items, one page) with `rateLimit { cost nodeCount }`: cost 4, nodeCount 6100. The same query with `size: fieldValueByName(name: "Size")` and `estimate: fieldValueByName(name: "Estimate")` added: cost 4, nodeCount 6100. Both lookups answered null on every item without an error, since Project #5 has neither field. `fieldValueByName` is a single value, not a connection, so it adds no points.

### The user's Projects, live

- Project #5 "todooverkill plan" has the custom fields Status (Shaping, Ready, Running, In review, Done), Start (DATE) and Target (DATE). It has no Size and no Estimate. `docs/plans/scheduler.md`, written earlier the same day, recorded no Start or Target on #5; they have been added since.
- Project #1 has a single select Size with the options "🐋 X-Large", "🦑 Large", "🐂 Medium", "🐇 Small" and "🦔 Tiny", and a Priority. Project #3 has Priority (High, Medium, Low) and no Size; Project #2 has neither. The design's build note says `project-management.md` lists a Size field on Projects 1 to 3; live, only #1 has one.

### todooverkill's runs, live

From the local database for the project named `todooverkill`:

- 44 succeeded, 2 cancelled and 1 waiting run, created 2026-09-30 to 2026-10-02. 47 runs have a planner's plan in run state.
- Wall time of the succeeded runs, `finished_at - started_at`: 10th percentile 44 min, 25th 52 min, median 65 min, 75th 93 min, 90th 109 min.
- Per succeeded run, medians: question time (`answered_at - created_at`, summed) 3.3 min, permission request time 0, last-stretch queue time (`claimed_at - runnable_at`, summed over executions) 11.2 min, reported cost $9.68 (maximum $18.11).
- Plans: steps 9, 11 and 12 at the 25th, 50th and 75th percentile (maximum 15); owned paths 10, 12 and 14 (maximum 27). The correlation with wall time is 0.43 for the step count and -0.02 for the owned path count. Split into thirds by steps plus paths, the first two thirds both have a median wall time near 62 min and the last 92 min.
- No run records a size, and no task in Project #5 has one.

## Unverified

- Whether `createProjectV2Field` with `SINGLE_SELECT` returns the new options with their ids in the same payload. The schema's `ProjectV2SingleSelectField` has `options`; PR 1 records it on a throwaway Project.
- How GitHub's own views show a fractional Estimate such as 10.5. The schema types it as `Float`.
- Whether several aliased `updateProjectV2ItemFieldValue` mutations in one request apply all or nothing. GitHub's example sends two in one request; no page says what happens when the second fails. The design assumes they are not atomic.
- Whether GitHub's secondary limit of "No more than 80 content-generating requests per minute" counts each mutation or each request. Arrange saves one request per task and spaces them (Design, Web).
- Whether a person dragging an item on GitHub's roadmap changes Start and Target in a way the 30-second refresh shows mid-drag on the dashboard. The dashboard keeps its optimistic bar until the write returns, then refreshes.

## Decisions

### 1. Size is a single select "Size" with S, M and L; Estimate is a Number field "Estimate" in hours

Both live on the plan's GitHub Project, like Status, Start and Target, so GitHub stays the store and a person can set them on GitHub's board. They are read by name with `fieldValueByName`, which cost no extra points live. Estimate holds hours as a Float; "2d" at 6 hours a day stores 12. Why a single select and not a label or a number: three fixed options group and filter on GitHub, and a size is a class, not a quantity. Why hours and not days for Estimate: a day's length is the project's capacity, which can change; hours do not.

An item reads Size only when its option is exactly S, M or L; any other option reads as no size (open question 1). An Estimate of 0 or less reads as no estimate, and typing 0 clears the field.

### 2. A run records the size its task had when it started

`runs.size` (S, M, L or null) is set by `startRun` from the items it already reads for the Ready gate, so a later change of the task's size does not move old runs between sizes. `runAgain` copies the size of the run it repeats. A run with no recorded size counts under its planner's proposal, and failing that under its task's current Size (open question 2). A run that links more than one task is left out of the forecasts (open question 4).

### 3. Queue time is measured exactly from now on

`node_executions.queued_ms` (integer, default 0) grows at every claim by the time since `runnable_at`, in the `claimNext` update. Every path back to pending sets `runnable_at` to now, and a retry sets it to the end of its delay, so the sum is the time an execution was ready and not running. Executions from before the column use `claimedAt - runnableAt` and so undercount. Why not events: `wakeByKey` writes no event, so the events cannot reconstruct pending stretches.

### 4. The forecast per size, computed on read

For a project and a size, the samples are its succeeded runs of that size (Decision 2) that link exactly one task. For each sample:

- wall = `finished_at - started_at`, nights included;
- waiting on you = the union of its questions' open intervals (`created_at` to `answered_at`) and its permission requests' (`created_at` to `decided_at`), clipped to the run;
- queue = the sum of its executions' queue time (Decision 3);
- agent = wall minus waiting minus queue, at least 0. It includes CI and pull request waits; the hover text says so;
- cost = the sum of its executions' `cost_usd`.

"Usually" is the median wall time. The split scales the median by each part's share of the summed parts over all samples, so agent, queue and waiting add up to the median shown. Cost is the median cost. With fewer than 5 samples the size uses its default, S 30m, M 1h, L 2h, and the measured median and count show next to "Default". Only succeeded runs count: failed and cancelled runs did not deliver the task, and a repaired run that then succeeded counts once with its full wall time. Why on read: a project has hundreds of runs, one query with three joins answers in milliseconds, and the project-management plan's rule of no plan caches holds.

### 5. A task's duration, in order: estimate, Size, proposal

A task's duration is its Estimate when it has one, else the forecast of its Size, else the forecast of its planner's proposal (drawn dashed), else none. A task with no duration keeps today's behaviour: a bar from Start to Target, or Unscheduled.

### 6. One capacity per project, the person's hours a day

`projects.plan_hours_per_day` (numeric, default 6, from 1 to 24) is set in Settings, Projects. A bar is its duration divided by the capacity, in days: at the Days zoom of 96 px a day and 6 hours, an hour is 16 px and an M of 50 minutes is 13 px. Agents running at once do not add capacity: the person reviews, answers and merges, and the forecast's waiting-on-you part is their time. Every day counts and the time of day does not matter. The capacity is configuration, not plan data, so it lives in handoff's database next to `plan_project_number`.

### 7. The planner proposes a size in its output

`PlannerOutputSchema` gains an optional `size` (S, M or L), `RunStateSchema.plan` keeps it, and `PROMPTS.planner` asks for it with one sentence on what each size means. A task without a Size shows the proposal of its latest run that has one, dashed, with "The planner proposed M from its plan: 6 steps, 4 owned paths." and "Use M". Only "Use M" writes it to GitHub. A task with a Size ignores proposals; the hover card names a disagreeing proposal. Why the planner's judgment and not a rule over counts: on todooverkill's 44 succeeded runs the owned path count does not track wall time (-0.02) and the step count only loosely (0.43), so a fixed rule would put most tasks in one size (open question 3).

### 8. Dragging writes at once, with Undo instead of an approval card

A drop writes Start and Target, and Estimate when the drop set or cleared one, through one port call that reads the item once and sends the mutations in one request. The dashboard shows "Saving #146 to GitHub", then "Moved #146 to Oct 2" with Undo, which writes the old values back the same way. A refused write puts the bar back with "GitHub did not take the date" and Try again. Why no confirmation: the person's drop is the decision, and a dialog after every drop is what project-management's open question 10 warned against. Writes by the assistant or the plugin keep their approval cards.

The drop path skips `schedule`'s `listItems` read: it checks Target on or after Start in the action, and `setPlanFields` reports an issue outside the Project or a missing field. One drop costs one `IssuePlan` read and one mutation request.

### 9. What drags

Tasks only. A Done task and a Running task do not drag (a run owns its task). A drop snaps to a day; the bar keeps its duration and Target follows. Dragging the right end of a sized task sets a manual estimate in one-hour steps. A drop before a blocker ends is allowed with a red arrow, a red bar edge and the warning "Starts before #143 ends"; the tasks it blocks stay where they are. Keyboard: arrows move a day, Shift and an arrow change the estimate by an hour, and one write follows the last key press or leaving the bar. An unscheduled task with a duration has a grip and drags onto the chart. No drag library: pointer events on the existing bar elements, since the gesture is one axis snapped to days.

### 10. Target follows from Start and the duration; the order inside a day is computed

Target is the day the task's hours end, counting from its Start, after the hours that tasks earlier in the day's order already use, at the capacity per day. Inside a day, bars sit one after another in blocker order, then by issue number. That order is not stored. handoff writes Target only on a person's drop, size change, estimate change or Arrange save; a forecast that moves later does not rewrite Targets (open question 6).

### 11. Arrange places unscheduled tasks only

"Arrange by estimate" takes the unscheduled tasks the filters show that have a duration, orders them by blocked-by links then by number, and fills each day from today up to the capacity after the load already planned, including tasks the filters hide. A task starts no earlier than the end of its placed blockers. A preview shows first; Save writes Start and Target per task. Tasks with dates stay where they are.

### 12. Forecast against actual

For a task with a bar, its run strips start under the bar's left edge at the bar's scale (hours times the day width over the capacity), at every zoom; the clock times move to the hover card. A task with runs and no bar keeps strips at clock time. While a run is active and its elapsed wall time passes the duration, the row shows "Over forecast by 50m" instead of "Overdue", and the strip's overrun is red.

### 13. Days zoom and formatting

A third zoom, Days, at 96 px a day, with day cells "Wed 30". The default zoom rule stays. A duration under a capacity day reads in hours and minutes ("50m", "2h 30m"); from a day it reads in days and hours ("1d 1h" for 7 hours at 6). A forecast reads "~50m", a default dotted, an estimate pinned. Sums on stories and epics start with "~" when any part is a forecast and end with "+1" per task with neither.

### 14. The fields are added on demand

A Project without Size or Estimate shows the banner "This Project has no Size and no Estimate field" with "Add the fields". `setup_plan` creates both on a new Project and adds the missing ones when it adopts one. An existing field named Size that is not a single select, or Estimate that is not a Number, is refused with a sentence, as `ensureDateFields` does for dates.

## Design

### Data model

One migration through `pnpm db:generate`, reviewed and committed:

- `runs.size text null` with a check of `size in ('S', 'M', 'L')`.
- `node_executions.queued_ms integer not null default 0`.
- `projects.plan_hours_per_day numeric(4,1) not null default 6` with a check of 1 to 24.

`RunStateSchema.plan` gains `size: z.enum(["S", "M", "L"]).optional()`; existing run state validates unchanged.

### Port

`packages/github/src/projects/types.ts`:

```ts
export type PlanSize = "S" | "M" | "L";
// PlanItem gains:
  /** S, M or L from the Size field; undefined without a value, without the field, or for another option. */
  size?: PlanSize | undefined;
  /** Hours from the Estimate field; undefined without a value, without the field, or at 0 or less. */
  estimate?: number | undefined;
// PlanProject gains:
  /** The Size field's id and the ids of its S, M and L options, and the Estimate field's id; undefined while missing. */
  estimateFields?: { size: { id: string; options: Record<PlanSize, string | undefined> } | undefined; estimate: string | undefined } | undefined;

/** Fields to write on an item: a value sets, null clears, a missing key leaves it. */
export type PlanFields = { start?: string | null; target?: string | null; size?: PlanSize | null; estimate?: number | null };
export type SetFieldsResult = "set" | "not-in-project" | "no-field" | "no-option";

// ProjectsPort gains:
  /** Writes several fields of an issue's item in one request after one read; checks every field and option first. */
  setPlanFields(repo: RepoRef, project: number, issue: number, fields: PlanFields): Promise<SetFieldsResult>;
  /** Creates Size (S, M, L) and Estimate (Number) when missing, adding S, M and L to an existing Size field; returns the ids. */
  ensureEstimateFields(login: string, number: number): Promise<NonNullable<PlanProject["estimateFields"]>>;
```

`setDates` stays and calls `setPlanFields`. Queries: `plan-items.graphql` gains the `size` and `estimate` lookups; a new fragment `PlanEstimateFields` (`size: field(name: "Size")` with options, `estimate: field(name: "Estimate")`) joins `PlanProject`, `PlanProjectChoice` and `IssuePlan`; `OPTIONAL_FIELD_ALIASES` gains `size` and `estimate`; `issuePlan` goes through `withOptionalFields`, which also fixes the existing throw on a Project without Start or Target. `plan-mutations.graphql` gains `CreatePlanSizeField` and `CreatePlanEstimateField`. `setPlanFields` builds one document with an aliased `updateProjectV2ItemFieldValue` or `clearProjectV2ItemFieldValue` per field (`value: { date }`, `{ singleSelectOptionId }` or `{ number }`). `ensureEstimateFields` adds S, M and L to an existing Size field with `updateProjectV2Field`, sending every existing option with its id, as `adoptedOptions` does. `createProject` and `adoptProject` call it. `FakeProjects` implements both.

### Read model and forecast computation

`apps/web/src/lib/plan/forecast.ts` (pure):

- `runParts(run, questions, permissions, executions)`: wall, waiting (interval union clipped to the run), queue, agent and cost of one run.
- `forecastOf(samples, size, opts)`: `{ size, source: "runs" | "default", minutes, parts: { agent, queue, waiting }, costUsd, runs, measuredMinutes }` with the median, the share split, the 5-run threshold and the defaults.
- `durationOf(item, forecasts, proposal)`: `{ hours, source: "estimate" | "forecast" | "default" | "proposal" } | undefined`.

`apps/web/src/lib/plan/duration.ts` (pure): `parseEstimate("3h" | "2d" | "1.5d" | "5h", capacity)` returns hours or an error sentence ("Use hours or days, like 3h or 2d."); `formatDuration(hours, capacity)` returns "50m", "2h 30m", "1d 1h", "1.5d" as the design writes them.

`apps/web/src/server/forecasts.ts`: `loadForecasts(db, projectId, sizeOfIssue)` runs one query over the project's succeeded runs with their questions, permission requests and executions, assigns each run its size (Decision 2, `sizeOfIssue` from the plan items), and returns the three forecasts and the capacity. `latestProposals(db, projectId)` returns, per issue, the size and the step and path counts of the newest run whose `state.plan.size` is set.

`loadPlan` adds `forecasts`, `capacity` and per task `proposal`, and passes durations to `deriveSpans`.

`apps/web/src/lib/plan/schedule.ts`: `deriveSpans(items, runs, now, { durations, capacity })` gives a task with a duration and a Start a `planned` span from Start to the computed end day, with `offsetHours` (hours already used on its first day by earlier tasks in the day's order) and `hours`; `overForecastMinutes` while a run is active and its elapsed wall time passes the duration (and then no `overdueDays`); `startsBeforeBlocker` per blocker that ends after the task's Start. A task with a duration and no Start stays unscheduled. `apps/web/src/lib/plan/load.ts`: `loadByDay(items, durations, capacity)` gives planned hours per day for every scheduled task with a duration. `apps/web/src/lib/plan/arrange.ts`: `arrange(tasks, placed, capacity, today)` returns `{ issue, start, target }[]` and the tasks it left out with the reason.

### Engine and planner

- `packages/db/src/ops/claim.ts`: `claimNext` sets `queued_ms = queued_ms + greatest(0, extract(epoch from now() - runnable_at) * 1000)`.
- `packages/engine/src/start-run.ts`: `createRun` gets `size` from the item of the run's single linked task when the Ready gate read items; `runAgain` passes the earlier run's size.
- `packages/core/src/schema/outputs.ts` and `run-state.ts`: `size` as above. `packages/engine/src/executors/cli-node.ts`: `PROMPTS.planner` gains "Set size to S for a change in one place, M for a feature across a few files, L for a change across several areas."

### Web and timeline

Written for a designer and an implementer; the design file has the frames and copy.

- Size chip (`components/plan/size-chip.tsx`): "S ~25m", "L ~2h" dotted for a default, "M ~50m" dashed for a proposal, "L 1.5d" with a pin for an estimate, "Size" dashed with neither, a spinner while saving. Its title gives the source ("Forecast for M: usually 50m, from 12 runs"). It sits in the tree's task rows, the board's card footer, the timeline's row labels and the Unscheduled rows; story and epic rows and board column headers show the sum.
- Size popover (`components/plan/size-popover.tsx`): S, M and L buttons with their forecasts, the forecast sentence ("Forecast from 12 finished M runs in todooverkill: usually 50m, about 15m of it waiting on you."), the planner's proposal with "Use M", then "Manual estimate", optional, with picks 1h, 2h, 3h, 4h, 1d, 2d, a field ("5h or 1.5d") with live text ("9 hours. Overrides the L default of 2h. Target moves to Oct 5.") or the error, and "Use the forecast". Picking a size saves at once; Enter saves the estimate. A task with dates gets its Target moved in the same write. It opens from the chip and from a focused bar with E.
- Server actions in `app/projects/actions.ts`: `setSizeAction({ projectId, issue, size, estimate? })`, `moveItemAction({ projectId, issue, start, target, estimate? })` (also Undo), `arrangeAction({ projectId, epic?, status? })` (the preview) and `saveArrangeAction({ projectId, items })`, `addEstimateFieldsAction`, `setCapacityAction`. They go through `shaping.ts` functions `setSize`, `moveItem` and `saveArrange`, which call `setPlanFields`. `saveArrange` writes one task at a time, at most one request per second.
- Timeline (`plan-timeline.tsx`): the Days zoom (`timeline-scale.ts` gains `days`, 96 px a day, with day cells, `ZOOMS`, `parseZoom` and `go_to_plan`'s enum); the load row under the dates ("Load at 6h a day", a cell per day with "6h 50m" and red over capacity, the tooltip "Oct 2: 6h 50m of 6h"); bars from `deriveSpans` with the forecast fade or the solid estimate; drag (`use-bar-drag.ts`: pointer capture, snap to day, the end handle on bars at least 12 px wide, the tooltip "Fri Oct 2 / M, forecast ~50m. Target Oct 2", the snap line and the ghost of the old place); the keyboard hint row; toasts with sonner; the Unscheduled header's "Arrange by estimate" with its disabled tooltip, the preview banner "Preview: 2 tasks, Oct 4 to Oct 6" with Cancel and "Save 2 tasks to GitHub", the tags "In preview", "Needs a size" and "Placing", and the grip. The chart header note about GitHub's roadmap goes. The hover card gains Size, Forecast with its parts and cost, Actual ("1h 40m so far, 50m over") and the clock times of the strips.
- The banner for missing fields sits where the date fields banner sits, with "Add the fields".
- List form under 640 px (`plan-timeline-list.tsx`): the size chip and a "Start" button that opens a date field; Target follows ("Target follows from the M forecast, ~50m: Oct 3."); no drag. A task with no duration keeps Schedule.
- Accessibility: a bar's name gains the size and duration ("#147 R7 Restyle the dashboard, Oct 4, size M, forecast 50 minutes"); keyboard moves are announced; saved and failed states are announced from the toasts.

### MCP tools and the plugin version

- `list_plan` returns per task `size`, `estimate_hours`, `proposal` (`{ size, run }` or null) and `duration` (`{ hours, source }`), and at the top `capacity_hours` and `forecasts` per size with parts, cost, runs and source.
- `set_size({ project, items: [{ issue, size?: "S" | "M" | "L" | null, estimate?: "3h" | "2d" | number | null }] })`: confirm, openWorld, idempotent. Writes Size and Estimate, and moves the Target of a task with a Start. Refuses an epic or a story, an issue outside the plan, an unknown estimate, and a Project without the fields (naming `setup_plan`). The approval card lists each task's old and new size and estimate.
- `arrange_plan({ project, epic? })`: read. Returns the Arrange preview: each placed task with Start and Target, and the tasks left out with the reason. The assistant then proposes `schedule` with those dates, one approval card.
- `create_task` gains `size`.
- The server instructions (`agent-mcp.ts:35`) gain one sentence: size tasks with `set_size` when the person sizes them; dates follow from sizes with `arrange_plan` and `schedule` when the person asks to plan the timeline. The `handoff` skill's "Shape first" section says the same.
- `plugins/handoff/.claude-plugin/plugin.json` goes from 0.5.0 to the next minor version on main when the PR lands, and `packages/connector/src/plugin.test.ts` checks the skill text.

### The capacity setting in Settings

Settings, Projects, under "Plan on GitHub": a "Fields" row ("Start, Target", "Size: S, M, L", "Estimate, Number", or "Add the fields"), a "Capacity" row ("6h a day" with Change, opening the popover "Hours a day" with "1d is 6h" and "Manual estimates stay in hours. A 12h estimate reads 2d at 6h a day and 1.5d at 8h a day."), and "Forecasts from finished runs" with the table Size, Usually, Agent, Queue, Waiting on you, Cost, Runs, a "Default" tag with "Measured 1h 50m over 3 runs; the forecast starts at 5.", and "Defaults: S 30m, M 1h, L 2h." The load row's label opens the same popover. Saving calls `setCapacityAction`.

### Projects

Project #5 gets its fields through "Add the fields" or `setup_plan`. Project #1's Size field gets S, M and L added next to its five options (open question 1). The Project's own board and roadmap show Size and Estimate like any field; nothing else on GitHub changes.

## Delivery

Each PR is one GitHub issue, one branch, CI green, one red-green slice per test named here, `pnpm doctor:react` clean after changes under `apps/web`, and Context7 before code against Next.js, Drizzle, Zod, Octokit or Vitest. PRs 1 and 2 are independent; 3 needs 1 and 2; 4 needs 3; 5 needs 3; 6 needs 4 and 5; 7 needs 6; 8 needs 4 and 5; 9 needs 3; 10 comes last.

1. **Port: Size, Estimate and one write per item.** Files: `packages/github/src/projects/{types,octokit-projects}.ts`, `queries/{plan-items,plan-project,issue-plan,plan-mutations}.graphql`, codegen output, `testing/fake-projects.ts`. First tests in `projects/octokit-projects.test.ts`: "listItems reads Size as S, M or L and Estimate in hours, and another Size option or an Estimate of 0 as none"; "a Project without Size and Estimate fields is read with no estimate field ids"; "status and date writes work on a Project that lacks Start, Target, Size and Estimate" (the `issuePlan` fix, with NOT_FOUND errors inside `projectItems`); "setPlanFields writes Start, Target, Size and Estimate in one request after one read, and clears a field with null"; "setPlanFields reports no-field and no-option and changes nothing"; "ensureEstimateFields creates Size with S, M and L and Estimate as a Number once"; "ensureEstimateFields adds S, M and L to an existing Size field and keeps its options with their ids"; "ensureEstimateFields refuses a Size that is not a single select". `fake-projects.test.ts` additions for both methods. Manual step on the PR: create a throwaway Project with the port, record whether `createProjectV2Field` returns option ids, write 10.5 to Estimate and record how GitHub shows it, then delete the Project by hand.

2. **Runs record size and queue time; the planner proposes.** Files: migration, `packages/db/src/schema/{runs,node-executions,projects}.ts`, `packages/db/src/ops/claim.ts`, `packages/engine/src/start-run.ts`, `apps/web/src/server/graphs.ts` (`runAgain`), `packages/core/src/schema/{outputs,run-state}.ts`, `packages/engine/src/executors/cli-node.ts`. First tests: `packages/db/src/ops/claim.integration.test.ts` "claiming adds the time since runnable_at to queued_ms, across a wait and a wake"; "a retry's delay is not queue time". `packages/engine/src/start-run.integration.test.ts` "startRun records the size of its single linked task from the items it read"; "a run without a sized task, or with two tasks, records no size"; `apps/web/src/server/graphs.integration.test.ts` addition "run again keeps the size of the run it repeats". `packages/core/src/schema/run-state.test.ts` addition "a plan may carry a size of S, M or L and nothing else". `packages/engine/src/executors/cli-node.integration.test.ts` addition "the planner's size reaches run state".

3. **Forecasts and the read model.** Files: `apps/web/src/lib/plan/{forecast,duration}.ts`, `apps/web/src/server/{forecasts,plan}.ts`, `agent-mcp.ts` (`list_plan` fields). First tests: `lib/plan/forecast.test.ts` (pure) "waiting on you is the union of open questions and permission requests inside the run"; "agent time is the wall time less waiting and queue, never below zero"; "usually is the median wall time and the parts add up to it"; "under five runs a size uses its default and keeps the measured median and count"; "durationOf prefers the estimate, then the size's forecast, then the proposal". `lib/plan/duration.test.ts` "3h, 2d and 1.5d parse to hours at the capacity and other text is refused"; "7 hours at 6 a day reads 1d 1h and 50 minutes reads 50m". `server/forecasts.integration.test.ts` (real Postgres) "only succeeded runs of the size that link one task count"; "a run without a recorded size counts under its planner's proposal, then its task's current size"; "queue time falls back to claimed minus runnable for executions without queued_ms". `server/plan.integration.test.ts` additions "loadPlan gives each task its size, estimate, proposal and duration, and the project its forecasts and capacity"; "a task with a Size ignores a planner's proposal". `server/agent-mcp.integration.test.ts` addition "list_plan returns sizes, estimates, durations, forecasts and the capacity".

4. **Spans with durations, load and Arrange (pure).** Files: `apps/web/src/lib/plan/{schedule,load,arrange,timeline-scale}.ts`. First tests: `schedule.test.ts` additions "a sized task's bar runs from Start for its duration over the capacity"; "tasks on one day sit in blocker order, then by number, and a later task's Target counts the hours before it"; "a task with a duration and no Start is unscheduled"; "an active run past its duration is over forecast and not overdue"; "a Start before a blocker's end is flagged with that blocker". `load.test.ts` "planned hours per day count every scheduled task with a duration, spread over its days". `arrange.test.ts` "arrange fills days from today up to the capacity after planned work, in blocker order"; "a task starts no earlier than its placed blockers end"; "tasks without a duration are left out with the reason". `timeline-scale.test.ts` addition "the days scale lays out 96 px days with day and month headers".

5. **Size chip, popover and the fields banner.** Files: `components/plan/{size-chip,size-popover}.tsx`, `plan-tree.tsx`, `plan-board.tsx`, `plan-timeline.tsx` (row labels and Unscheduled), `timeline-parts.tsx` (banner), `apps/web/src/server/shaping.ts` (`setSize`, `addEstimateFields`, `setup_plan` creating the fields), `app/projects/actions.ts`. First tests: `size-chip.test.tsx` "the chip shows a forecast, a dotted default, a dashed proposal, a pinned estimate and Size when there is none"; `size-popover.test.tsx` "picking a size saves it at once"; "a typed estimate shows its hours and the forecast it overrides, and a typo shows the hint"; "Use M writes the planner's proposal and Use the forecast clears the estimate"; `plan-board.test.tsx` addition "a column header sums its tasks with ~ and +n"; `plan-timeline.test.tsx` addition "a Project without Size and Estimate shows the banner and Add the fields". `server/shaping.integration.test.ts` additions "setSize writes Size and moves the Target of a task with a Start"; "setup_plan creates Size and Estimate on a new Project and adds them when adopting".

6. **Drag, keyboard, Undo, the Days zoom and the load row.** Files: `components/plan/{plan-timeline,use-bar-drag,load-row,plan-timeline-list}.tsx`, `lib/project-tab.ts`, `lib/assistant/{catalog,ui-tools}.ts` (`go_to_plan` zoom), `shaping.ts` (`moveItem`), `actions.ts` (`moveItemAction`). First tests (web): `plan-timeline.test.tsx` additions "dragging a bar moves its Start a day at a time and the tooltip names the Target that follows"; "dropping saves Start and Target and the toast's Undo writes the old dates back"; "a refused write puts the bar back and offers Try again"; "dragging the end of a sized task sets a manual estimate in hours and keeps the size"; "a drop before a blocker ends is allowed with the warning"; "Done and Running bars do not drag"; "arrows move a focused bar a day and Shift with an arrow changes its estimate, with one save after the last key"; "an unscheduled task with a size drags onto the chart and one without has its grip off with the reason"; "the load row shows hours per day and marks a day over capacity"; "strips start under the bar at its scale and the hover card gives clock times"; "the Days zoom lives in the URL". `plan-timeline-list.test.tsx` addition "under 640 px a task shows its size and a Start field whose Target follows the duration". `server/shaping.integration.test.ts` addition "moveItem writes Start, Target and Estimate in one request and refuses a Target before Start".

7. **Arrange by estimate.** Files: `plan-timeline.tsx` (Unscheduled header and preview), `shaping.ts` (`previewArrange`, `saveArrange`), `actions.ts`. First tests: `plan-timeline.test.tsx` additions "Arrange shows a preview of the placed tasks and writes nothing until Save"; "Save writes Start and Target for each task and Cancel leaves them unscheduled"; "Arrange is off when no unscheduled task has a size or an estimate". `server/shaping.integration.test.ts` addition "saveArrange writes one task at a time and reports a task GitHub refused".

8. **MCP tools and the plugin.** Files: `lib/assistant/catalog.ts` (`set_size`, `arrange_plan`, `create_task.size`), `server/agent-mcp.ts` (handlers and the instructions line), `plugins/handoff/skills/handoff/SKILL.md`, `plugins/handoff/.claude-plugin/plugin.json`. First tests: `server/agent-mcp.integration.test.ts` additions "set_size writes sizes and estimates and moves the Target of a dated task"; "set_size refuses an epic, an issue outside the plan, an unknown estimate and a Project without the fields"; "arrange_plan returns placements and the tasks it left out, and writes nothing"; "create_task with a size sets it". `catalog.test.ts` addition "set_size is confirm and its summary names each task with its old and new size and estimate". `packages/connector/src/plugin.test.ts` addition "the handoff skill names set_size and arrange_plan".

9. **Settings: capacity and forecasts.** Files: `components/settings/projects-settings.tsx`, `components/settings/capacity-popover.tsx`, the Settings, Projects page's loader (forecasts per project), `actions.ts` (`setCapacityAction`). First tests: `projects-settings.test.tsx` additions "Plan on GitHub lists the fields and offers Add the fields when Size or Estimate is missing"; "the forecasts table shows each size's usual time, parts, cost and runs, and a default with its measured median"; `capacity-popover.test.tsx` "the capacity takes 1 to 24 hours and says how a 12h estimate reads". `app/projects/actions.integration.test.ts` addition "setCapacityAction stores hours a day for the project and refuses a value outside 1 to 24".

10. **Docs.** Files: `GLOSSARY.md` (Size, Estimate, Forecast, Capacity), `docs/adr/0007-github-projects-is-the-plan-store.md` (Size and Estimate fields; capacity and run size are handoff configuration and run data), `docs/plans/project-management.md` (the drag non-goal and open question 10 marked reversed, with a link here), `README.md` (the Plan timeline section).

## Risks

| Risk | Mitigation |
|---|---|
| Forecasts from few runs mislead | The 5-run threshold with defaults, the run count on every forecast, and the measured median next to "Default". |
| Wall time includes nights, so a forecast of a size the person answers late is long | The split shows waiting on you; Decision 4 keeps nights in, as the user decided. |
| A drop writes Start and Target in one request that fails halfway | The error names what GitHub refused, the bar goes back to what the next read shows, and Undo writes every field it changed. |
| The 30-second refresh lands during a drag | The drag keeps its own state until the drop's write returns; the refresh after the write wins. |
| Keyboard moves or Arrange hit GitHub's secondary limits | One write after the last key press; Arrange writes one task per second. |
| Adding Size and Estimate lookups to `IssuePlan` breaks writes on Projects without them | PR 1 routes `issuePlan` through `withOptionalFields` and tests a Project without any of the four fields. |
| A Project already has a Size field with other options (Project #1) | Add S, M and L keeping its options with their ids; other options read as no size (open question 1). |
| A planner's proposal appears only after a run reached its planner | The popover names the run; Shaping tasks are sized by a person or by the assistant through `set_size` and `create_task`. |
| The planner's sizes are noisy | A proposal is dashed and never written without a person's pick; a person's Size wins. |
| The capacity changes and GitHub's Targets no longer match the bars | Bars follow the capacity; handoff rewrites Targets only on a person's action; the hover card shows GitHub's Target when it differs (open question 6). |
| The reported cost on a subscription is not money spent | The table and the hover card label it "reported cost". |
| Runs that link several tasks have no single size | They are left out of forecasts (open question 4); their strips still show under each task. |
| Small bars at Weeks and Months are hard to grab | Move by dragging works at every zoom; the end handle shows only on bars at least 12 px wide; the popover sets an estimate at any zoom. |

## Open questions

These are new; the design's twelve questions are answered in the Decisions above. Each has a recommended answer; unanswered, the implementation takes the recommendation.

1. A Project already has a Size field with other options. Project #1 has five: 🐋 X-Large, 🦑 Large, 🐂 Medium, 🐇 Small, 🦔 Tiny. Recommended: "Add the fields" adds S, M and L to the field and keeps its options with their ids, so no item loses its value; another option reads as no size, and the banner says which.
2. Runs from before runs record a size. todooverkill has 44 succeeded runs and none has a size. Recommended: a run without a recorded size counts under its planner's proposal, then under its task's current Size, so sizing finished tasks seeds the forecasts.
3. How the planner proposes a size. Recommended: the planner's own judgment in a new optional `size` output field. A fixed rule over counts would not separate sizes on todooverkill: owned paths correlate -0.02 with wall time and steps 0.43, and the lower two thirds of runs by count both take about 62 minutes.
4. Runs that link several tasks. Recommended: left out of the forecasts; their strips show under each task as today.
5. Time a pull request waits in a manual merge queue. Recommended: count it as waiting on you, from `merge_queued_at` to `merge_requested_at`, since only a person moves it on.
6. A Target on GitHub that disagrees with Start plus the duration, after an edit on GitHub's roadmap, a forecast that moved or a new capacity. Recommended: the bar follows Start and the duration; the hover card shows "Target on GitHub: Oct 7"; Overdue uses GitHub's Target; handoff rewrites Target only on a person's drop, size or estimate change, or Arrange save.
7. Tasks with dates but no size or estimate in the load row. Recommended: left out of the hours; the load tooltip counts them ("2 tasks with dates have no size").

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

By hand on todooverkill (project `6c588fd7-a382-4b79-b10b-695212d490e2`, GitHub Project #5), with `pnpm dev:web` and `pnpm dev:worker` running (the worker from a separate worktree, since `tsx watch` restarts it on edits):

1. Open the Plan timeline. Expect the banner "This Project has no Size and no Estimate field". Press "Add the fields". With `gh api graphql`, expect a single select Size with S, M and L and a Number field Estimate on Project #5, and Status, Start and Target unchanged.
2. Measure `rateLimit { cost }` of the `PlanItems` query on Project #5 after PR 1: expect 4 points per page, as before.
3. Open Settings, Projects. Expect Capacity "6h a day" and the forecasts table with Default for S, M and L and 0 runs. Size five tasks whose runs succeeded as M on GitHub's board. Expect M to show a forecast from 5 runs whose median matches `percentile_cont(0.5)` of those runs' wall times in the database (open question 2's recommendation).
4. In the tree, size #146 M from its chip. Expect "Saved" and the Size on GitHub. Type "1.5d" as #149's estimate: expect "9 hours", Estimate 9 on GitHub, and the pinned chip. Press "Use the forecast": expect the Estimate field cleared.
5. At the Days zoom, drag #146 one day earlier. Expect the tooltip with the Target that follows, the toast, Start and Target on GitHub, and Undo putting both back. Drop it before #143's end: expect the warning and the red arrow, and #143 not moving.
6. Drag the end of a sized bar two hours longer. Expect Estimate on GitHub and the size unchanged. Try to drag a Done task and a Running task: expect neither to move.
7. Filter to epic #122 and press "Arrange by estimate". Expect the preview with each task's dates and #65 left out if it has no size. Cancel: expect nothing on GitHub. Arrange again and Save: expect Start and Target on GitHub for each placed task.
8. Change the capacity to 8 hours. Expect shorter bars, estimates still in hours, and no Target changed on GitHub.
9. Move a sized task to Ready and start a run on it. Expect the strip under the bar from its left edge, the clock times in the hover card, and after the run passes the duration "Over forecast by" instead of "Overdue". After the planner passes on a task without a Size, expect a dashed proposal with "Use M"; press it and expect Size on GitHub. Set a Size first on another task and expect a later proposal not to replace it.
10. Under 640 px, expect the size chips and a Start field whose Target follows; no drag.
11. With `gh api rate_limit` before and after ten minutes with the timeline open and three drops: expect at most 25 GraphQL points used by the page plus one read and one mutation request per drop.
12. In Claude Code with the updated plugin, ask to size the tasks of story #127 and to arrange epic #122. Expect a `set_size` approval card listing each task's old and new size, `arrange_plan` placements, and one `schedule` approval card with those dates.
