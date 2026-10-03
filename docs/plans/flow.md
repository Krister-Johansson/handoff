# Plan Flow mode

## Context

Issue #490 asks for a second way to plan a project: an order of work without dates. A project's plan mode becomes a setting, Flow or Timeline, so people and agents never mix the two. In a Flow project no agent and no MCP tool sets Start or Target dates or schedules by time; they still build the path, the order of the tasks and their blockers ("first X, Y and Z; when X is done, start its child task"). In a Timeline project dates and estimates work as today. The Plan page shows the view that matches the mode, with no Flow or Timeline switch in its toolbar, and a tool that only makes sense in the other mode says so instead of doing the work.

The issue's comments add the rest. The Flow keeps the Timeline's tree of epics, stories and tasks on the left with the cards on the right on their rows. Dragging a card changes the task's place in Project order, the order the scheduler starts tasks in, and the lanes recompute. A task never starts before its blockers; a drop before a blocker opens a dialog with three choices and a "Move the tasks that wait on it" checkbox. A task with the skip label or a cancelled latest run keeps its place and shows as skipped. A card moved by hand is pinned. An Optimize button arranges the unpinned cards for the earliest finish, on the whole plan or on what is ticked in the tree, as a preview first, with Undo; `arrange_plan` does the same for agents in a Flow project.

The last comment records the user's approved decisions:

1. The toolbar keeps Tree and Board. The third view is Flow or Timeline, following the project's plan mode.
2. Pins are stored in handoff's database, keyed by issue, since GitHub Projects has no field for them.
3. Dragging works in Project order. Under Priority order, a drop asks to switch the scheduler to Project order.
4. Project settings drop the Default graph card; the Graphs list marks the default. Library becomes four global settings sections: Skills, Agents, MCP servers and Groups.

Decision 4 belongs to issue #491, which moves project settings to a side menu with a Plan group (Plan mode, Scheduler). This plan builds the Plan mode section for that layout and does not build the rest of #491.

The approved design is `plan/Plan flow.dc.html` with `PlanFlowMain`, `PlanFlowDrag`, `PlanFlowDialog`, `PlanFlowKeep`, `PlanFlowOptimize` and `PlanFlowAfter` in the Claude Design project "handoff dashboard" (`5e1de671-ec5a-48e5-9adc-7afd356df858`): five frames, the decisions, the copy and seven open questions. The Plan mode section is in `shell/Settings.dc.html`, frame 2 (`/projects/<id>/settings?tab=mode`). The design's sample data, steps, slots, pins and the held state are invented, as its About section says.

This plan builds on `docs/plans/scheduler.md` (the scheduler, its order and its holds) and `docs/plans/estimates.md` (sizes, forecasts, the timeline's drag, toasts and Undo, and `arrange_plan`). Read `CLAUDE.md`, `GLOSSARY.md`, `docs/plan.md` and those two plans first.

## Goals

- A plan mode per project, Flow or Timeline, set in Project settings under Plan, Plan mode.
- Every agent-facing path follows the mode: MCP tools, the server instructions, the `handoff` skill, the planner and the dashboard assistant. A tool for the other mode refuses with one sentence that names what to use instead.
- In a Flow project the Plan page's third view is Flow: the tree on the left, an order axis with a Now line on the right, one lane per run the scheduler may hold at once, and each task's card on its row, placed where the scheduler would start it.
- One pure layout function, used by the Flow view and by `arrange_plan`, so the page and the agents see the same flow.
- Dragging a Ready card writes its new place in Project order to GitHub at once, pins it, and offers Undo. A drop before a blocker opens the rule-break dialog.
- Optimize, on the whole plan or on the ticked epics, stories and tasks, with a preview, Apply and Undo. Pins never move.
- `arrange_plan` in a Flow project previews the optimized order; a new `set_order` writes an order with an approval card.

## Non-goals

- Dates, hours and capacity in a Flow project. The Flow shows no dates and no hours anywhere; sizes only decide which lane frees first.
- Changing what the scheduler starts or when. It keeps starting Ready tasks without open blockers in Project order or Priority order (`docs/plans/scheduler.md`, Decision 3); pins and the Flow do not change its rules.
- Writing the Priority field. Under Priority order dragging is off until a person switches the scheduler to Project order.
- Moving epics and stories in Project order. Only tasks drag; an epic or story card is a derived span.
- Dragging on the Board or in the Tree view. The board's note stays ("Drag cards on GitHub. This board shows the Project; it does not move cards.").
- Clearing Start and Target when a project switches to Flow, or setting dates when it switches to Timeline.
- The rest of issue #491: the Graphs and Default library sections, the Library sections in Settings and the redirects.
- Dragging under 640 px.

## Verified facts

Code facts are from `main` at `b33c27e`, read on 2026-10-03. Design facts are from the Claude Design files named above, read the same day.

### The scheduler's order and rules

- `candidates(items, runs, opts)` (`packages/engine/src/backlog-scheduler/candidates.ts:29-47`) sorts items by rank, then by `item.position ?? index` (`:37-39`). In Project order every rank is 0; in Priority order an item ranks by its option's index in `priorityOptions`, and an item without a value ranks after every option (`:31-36`). Only open tasks in Ready count (`:41`).
- `skipReason` (`:49-56`) returns, in order: `labelled <skipLabel>` (`:50`), `blocked by #a, #b` while `blockedBy` is not empty (`:51`), `taken by run <id>` for an active run (`:52`), and `cancelled run; start it by hand` for a cancelled latest run that no `scheduler.released` event released (`:54`).
- So a blocked task never holds a slot: `examine` (`tick.ts:125-178`) tries candidates in order and starts the first one it may (`:148-176`). A blocked task is skipped and the next candidate starts.
- `examine` stops on a hold (`:132`), on a full project (`:133`, `activeRuns` counts every `queued`, `running` or `waiting` run of the project, `:216-222`), and while a run the scheduler started has no plan (`planningRun`, `:225-233`). It starts at most one run per check (`:147`).
- `projectHolds` (`holds.ts:16-34`) holds on failed runs (kind `loop` for an exhausted loop) and pending permission requests only. Questions, reviews, Try it, pull request reviews and the merge queue do not hold; those runs count toward `max_runs` (`holds.ts:11-15`).
- `issueRuns` (`issue-runs.ts:8-18`) gives each issue its active run, else its latest; `releasedRuns` (`:24-30`) reads `scheduler.released`.
- `project_schedulers` (`packages/db/src/schema/schedulers.ts:10-48`) holds `max_runs` (1 to 10, default 1, `:18`, `:42`), `order` (`project` or `priority`, `:20`, `:43`), `graph_name`, `skip_label` (default `human`, `:24`) and the check state. A row exists once someone turns the scheduler on.
- `@handoff/engine/backlog-scheduler` (`packages/engine/package.json` exports) re-exports `candidates` together with `checkProject`, `projectHolds` and the loop (`backlog-scheduler/index.ts`), which import `@handoff/db`. A client component cannot import it.
- The Claude cap is `HANDOFF_CAP_CLI` (`apps/worker/src/env.ts:14`), stored in `workers.caps` (`packages/db/src/schema/workers.ts:7`). `getScheduler` (`apps/web/src/server/scheduler.ts:194-254`) reads `caps.cli` of the newest live worker (`:214-219`) and says "N of M runs active, K Claude slots" (`:221`). `startScheduler` (`:59`) refuses Priority order without a Priority field (`:73-78`).
- `scheduler-card.ts` already calls `candidates` on the dashboard's server (`apps/web/src/server/scheduler-card.ts:2`, `:104`), and `nextPlaces` (`:150-152`) numbers the next three candidates for the tree's `NextTag` (`apps/web/src/components/scheduler/next-tag.tsx:7-15`, rendered in `plan-tree.tsx:134`).
- `startRun` (`packages/engine/src/start-run.ts:57`) takes the per-project advisory lock and inserts the run in one transaction (`:85-90`).

### Project order on GitHub

- `listItems` (`packages/github/src/projects/octokit-projects.ts:137-141`) pages `PlanItems` (`packages/github/src/queries/plan-items.graphql:1-4`) in GitHub's POSITION order and numbers every item, drafts and other repositories' issues included, so `position` has gaps (`types.ts:39`; test "listItems numbers items by their position across pages", `octokit-projects.test.ts:152-168`).
- `PlanItems` does not select the item's node id. `IssuePlan` does (`issue-plan.graphql:78-85`), and the private `itemIdsOf` (`octokit-projects.ts:382-403`, document in `plan-fields.ts:70-77`) maps issue numbers to item ids 100 at a time.
- Nothing in the repository writes Project order. `updateProjectV2ItemPosition` appears only in the vendored schema (`packages/github/src/schema/schema.docs.graphql:29861-29866`): "updates the position of the item in the project, where the position represents the priority of an item". Its input (`:70880-70898`) is `projectId`, `itemId` and `afterId`; "If omitted or set to null the item will be moved to top." No `.graphql` operation, codegen document, port method, fake or test uses it, and `git log --all -G updateProjectV2ItemPosition` over `packages/github/src` and `apps/web/src` finds nothing.
- The batching to reuse is `setManyPlanFields` (`octokit-projects.ts:354-379`): one read, checks first, then requests of at most `MUTATIONS_PER_REQUEST = 20` aliased mutations (`:59`, rationale `:54-58`) built by `byMutationCount` (`:64-78`); a refusal part way throws naming what was written (`:372-375`). Octokit's throttle spaces GraphQL calls about a second apart (`octokit-projects.ts:86-95`, test `octokit-projects-throttle.test.ts:13-43`).
- `FakeProjects` keeps Project order as the insertion order of its `items` Map (`packages/github/src/testing/fake-projects.ts:58-59`) and numbers it in `listItems` (`:109`). It has no way to reorder.
- `createProject` creates the Start and Target fields (`octokit-projects.ts:194`, `:207`). `setupPlan` (`apps/web/src/server/shaping.ts:69`) adds missing date fields (`:82`) and Size and Estimate (`:84`).
- `splitPlan` (`apps/web/src/server/graphs.ts:228-260`) opens each later part of a split plan with `projects.createIssue` as a sub-issue of the run's issue (`:252`), which lands at the end of Project order.

### The Plan page

- `page.tsx` (`apps/web/src/app/projects/[projectId]/plan/page.tsx:24-40`) loads `loadPlan`, the scheduler card and signals, and renders `PlanTab` with `view={parsePlanView(query)}` and `next={nextPlaces(scheduler)}` (`:80-94`).
- `PLAN_VIEWS = ["tree", "board", "timeline"]` (`apps/web/src/lib/project-tab.ts:32-33`); `parsePlanView` defaults to `tree` (`:41-45`). `ViewToggle` (`apps/web/src/components/plan/plan-toolbar.tsx:24-48`) lists the views (`:17-21`) and writes `?view=` through `planPath` (`apps/web/src/lib/paths.ts:29-43`). `PlanBody` switches on the view (`plan-tab.tsx:130-152`).
- The timeline is one grid with absolutely placed rows (`plan-timeline.tsx:1199-1245`): a sticky `RowLabel` (`:589-627`) and a grid cell with the bars, from `timelineRows` (`apps/web/src/lib/plan/timeline-rows.ts:114-153`). `FlagCard` (`timeline-flag-card.tsx:195-231`) shows row warnings. `PlanTimeline` switches to `PlanTimelineList` under 640 px (`plan-timeline.tsx:1269-1271`).
- The timeline's write pattern is `useMoves` (`plan-timeline.tsx:835-908`): `toast.loading`, an optimistic change, the server action, then `toast.success` with Undo that writes the old values back, or `toast.error` with Try again (`:854-878`). `PlanRefresher` refreshes every 30 seconds while the tab is visible (`plan-refresher.tsx:10`, `:30-37`).
- No multi-select exists in the tree, the board or the timeline; the tree has one active row (`plan-tree.tsx:85`, `:247-275`).
- `forecastOf` (`apps/web/src/lib/plan/forecast.ts:104`) gives each size its median wall time from this project's runs, with defaults S 30m, M 1h, L 2h under five runs (`:89-91`). `loadPlan` (`apps/web/src/server/plan.ts:82-162`) returns the tree, the board, forecasts and the timeline.
- `describeNow` (`apps/web/src/lib/run-now.ts:34-61`) says what a run waits for: a permission, blockers, the merge queue, a review, a question, or CI and reviews on its pull request.

### Run progress and loops

- No code counts a run's steps against its graph. `RunLine.steps` (`apps/web/src/server/run-lines.ts:16-32`) lists the nodes a run visited, without a total.
- A node execution is one row per visit, `attempt` counting per node (`packages/db/src/schema/node-executions.ts:17`, `:66`), with `created_at` (`:62`) and an index on `(run_id, created_at)` (`:79`).
- Loops are edges with `loop: true` and `maxAttempts` (`packages/core/src/schema/graph.ts:43-45`). Non-loop edges form the acyclic graph, and any other cycle is a compile error (`packages/core/src/graph/compile.ts:142`, `:256-258`). Exhausted routes go to `onExhausted` or the graph's `exhaustedGate` (`graph.ts:45`, `:57`; listed at `compile.ts:242-243`). Start and Finish are optional `function` nodes (`compile.ts:214-222`). Nothing marks which nodes sit inside a loop.
- `state.plan.steps` (`packages/core/src/schema/run-state.ts:74-76`) is the planner's list of work, not the graph's nodes.

### Agent paths

- `CATALOG` (`apps/web/src/lib/assistant/catalog.ts`): `list_plan` (`:411-422`), `setup_plan` (`:435-450`), `create_story` with `start` and `target` (`:463-482`), `create_task` with `start`, `target` and `size` (`:483-506`), `schedule` (`:533-556`), `set_size` (`:557-586`), `arrange_plan` (read only, `:587-598`), `start_scheduler` (`:628-645`) and `go_to_plan` with `view: tree | board | timeline` (`:714-731`).
- Handlers live in `handlersFor` (`apps/web/src/server/agent-mcp.ts:277`): `list_plan` (`:540-572`), `schedule` (`:607`), `set_size` (`:609-624`), `arrange_plan` (`:626-651`, `loadPlan` plus `arrangeTimeline`), `get_project` (`:305`). A handler refuses by throwing an `Error`; the `tool()` wrapper turns it into a text result with `isError: true` (`:49-58`).
- The server instructions (`INSTRUCTIONS`, `agent-mcp.ts:38-46`) tell agents at `:42` to set dates with `schedule` when the person asks to plan the timeline and to use `set_size` and `arrange_plan`. The dashboard assistant's system prompt is these instructions plus its own lines (`apps/web/src/server/assistant/prompt.ts:4-12`); its per-turn page block names the page (`:25-40`). The Plan page has no page kind (`apps/web/src/lib/assistant/page-tools.ts:6`).
- The `handoff` skill says the same in "Shape first" (`plugins/handoff/skills/handoff/SKILL.md:22-23`); `packages/connector/src/plugin.test.ts:36-51` checks that text and `:86` pins the plugin version `0.13.0`.
- The planner proposes a size and never a date (`PROMPTS.planner`, `packages/engine/src/executors/cli-node.ts:29-36`). No engine code writes dates or Project order.

### Settings

- Project settings (`apps/web/src/app/projects/[projectId]/settings/page.tsx`) is one column: Default graph (`:50-74`), Default library (`:75`) and the scheduler (`:76-84`). Settings already has a side menu (`apps/web/src/app/settings/page.tsx:141-142`, `components/settings/settings-nav.tsx:6-51`, tabs in `lib/settings-tab.ts`).
- `projects` (`packages/db/src/schema/projects.ts:8-43`) has no plan mode. Migrations are folders under `packages/db/drizzle/`; the latest is `20261002232807_plan_budget`.

### The design

- Frame 1 places cards by lanes ("Slot 1" to "Slot 3"), a Now line, steps on running cards ("3 of 7 steps"), "Waits on you: review", "After #55", "Next 1", "Pinned", "Waits for the hold", "Skipped: label human", "Skipped: latest run cancelled", "In review, no slot" and "Not in the order", with Optimize, "Flow mode" and Legend in the toolbar.
- Three of its sample choices differ from the scheduler as built: the frame holds the scheduler on a review ("Held: #56 waits for your review"), while only failed runs and permission requests hold; it puts #57 in slot 2 to wait for #55, while the scheduler starts the next task without an open blocker instead; and it gives a run in review no slot, while the scheduler counts such a run toward `max_runs`. Decisions 4 and 5 follow the scheduler.
- The Settings design's Plan mode section is two radio cards, Flow ("Order, no dates") and Timeline ("Dates and estimates"), with Save and "Switching to Timeline keeps the order. Tasks get dates when someone or an agent schedules them."

## Unverified

- Whether several aliased `updateProjectV2ItemPosition` mutations in one request run in document order, so a later move may name an item an earlier move placed as its `afterId`. The GraphQL specification runs top-level mutation fields serially; GitHub's docs do not say. PR 2 records it on a throwaway Project.
- Whether a moved item shows at its new place in GitHub's table view without a sort, and at once in `items` ordered by POSITION. `docs/plans/scheduler.md` left open whether a person's reorder on GitHub changes POSITION; PR 2 records both directions.
- The rate cost of selecting the item `id` in `PlanItems`. A node's id is a scalar and should add no points; PR 2 measures `rateLimit { cost }`.
- Whether GitHub's secondary limit counts each mutation or each request. A drag writes one to three mutations; Optimize writes at most the number of tasks it moves, 20 per request.

## Decisions

### 1. The mode is a column on the project, Timeline for existing projects

`projects.plan_mode` is `flow` or `timeline`. The migration gives every existing project `timeline`, so nothing changes for a project until a person switches it; a project added after the migration starts in `flow` (open question 1). The mode is configuration, like `plan_hours_per_day`, so it lives in handoff's database, not on the GitHub Project.

Only a person changes the mode, in Project settings. No MCP tool writes it; `get_project` and `list_plan` read it. Switching keeps everything on GitHub: Start, Target and Estimate stay on the items unread in Flow mode, and Project order stays as it is in Timeline mode (the scheduler reads it in both).

The mode needs no plan to be set. A project without a GitHub Project shows the Plan page's empty state in either mode.

### 2. What each path does per mode

| Path | Timeline | Flow |
|---|---|---|
| Plan page | Tree, Board, Timeline | Tree, Board, Flow |
| `list_plan` | as today, plus `mode` | `mode`, each task's place, lane, pin, waits and progress; no dates, hours, capacity or forecasts |
| `schedule` | as today | refuses |
| `arrange_plan` | Arrange by estimate, as today | the Optimize preview (Decision 9) |
| `set_order` (new) | refuses | writes an order and pins, with an approval card |
| `set_size` | as today | sizes only; an estimate is refused |
| `create_story`, `create_task` | as today | `start`, `target` refused; `size` allowed |
| `setup_plan` | adds Start, Target, Size, Estimate | adds Size only |
| `go_to_plan` | `view: timeline`, `zoom` | `view: flow`; `timeline` refused |
| Server instructions, skill | dates when asked | order and blockers, never dates |
| Planner | proposes a size | proposes a size; a split's parts land right after the task |
| Assistant | the instructions above | the instructions above |
| Scheduler | unchanged | unchanged |

Refusals are one sentence naming the mode and the way forward, thrown from the handler so the agent reads them as `isError` text:

- `schedule` in Flow: "todooverkill plans in Flow mode: tasks have an order and blockers, no dates. Use arrange_plan and set_order, or a person can switch the plan mode in Project settings."
- `set_order` in Timeline: "todooverkill plans in Timeline mode: order work with dates through arrange_plan and schedule."
- An estimate in Flow: "todooverkill plans in Flow mode, which has no hours. Set a size: S, M or L."
- Dates on `create_story` or `create_task` in Flow: "todooverkill plans in Flow mode, which has no dates. Leave start and target out; set_order places the task."
- `go_to_plan` with `view: timeline` in Flow, and `view: flow` in Timeline, through `UiToolError` (`apps/web/src/lib/assistant/ui-tools.ts:15`).

Nothing is written before a refusal. Sizes stay in both modes because the Flow uses them for which lane frees first.

The server instructions are static per server, so they describe both modes in one paragraph: a project plans in Flow or Timeline mode (`get_project` and `list_plan` say which); in Flow mode set only the order and the blockers, with `create_task`'s `blocked_by`, `arrange_plan` and `set_order`, and never dates; in Timeline mode dates as today. The `handoff` skill's "Shape first" gains the same rule. The planner's prompt does not change: it already sets no dates.

### 3. The scheduler is the same in both modes

The scheduler starts Ready tasks without open blockers in Project order or Priority order, in Flow and Timeline projects alike. It does not read pins: a pin is a mark on a place in Project order, and the place is what the scheduler reads. In a Flow project the Plan page's "Next n" tags come from the flow's order (Decision 6) in every view, so the tree, the Flow and the scheduler card agree.

Under Priority order the order follows the Priority field, so a drop cannot express it. A drop in a Flow project whose scheduler orders by Priority opens "The scheduler starts tasks by Priority. Switch it to Project order to plan by dragging?" with "Switch to Project order" and Cancel. Switching saves the scheduler's `order` through `startScheduler`'s settings path and then applies the drop. Optimize and `set_order` refuse the same way until the switch.

### 4. Lanes are the scheduler's `max_runs`

A Flow has one lane per run the scheduler may hold at once: `max_runs` from `project_schedulers`, or 1 without a row. The Claude cap does not change the lane count: with `max_runs` 3 and `HANDOFF_CAP_CLI` 1 the scheduler still starts three runs, which take turns at their Claude steps (`docs/plans/scheduler.md`, Decision 7). The header says both, as the scheduler card does: "3 runs at once, 1 Claude slot" (open question 2).

When more runs are active than lanes (a person started some by hand), the extra runs get lanes of their own that close when their run ends, since the scheduler starts nothing while the project is over its limit.

An active run keeps its lane whatever it waits for, a review, a question, CI or the merge queue, because the scheduler counts it toward `max_runs`. Its row says what it waits for. This differs from the mock's "In review, no slot" (open question 3).

### 5. The layout follows the scheduler's rules, step by step

`layoutFlow` simulates the scheduler from now, in abstract time units:

1. Each active run takes a lane, oldest first. Its card straddles Now: the share left of Now is its done steps over its total (Decision 7), and the rest is the remaining length.
2. The queue is the Ready tasks the scheduler may start, in the scheduler's order: open tasks in Ready, without the skip label, without an active run, and without a cancelled latest run that nobody released. Tasks with the skip label or a cancelled run keep their row with "Skipped: label human" or "Skipped: latest run cancelled" and "Not in the order" on the axis.
3. When a lane frees, the first task in the queue whose blockers have all ended by then starts in it. A blocker has ended when its issue is closed, or when its card ends earlier in the simulation. A task whose blocker has not ended stays in the queue, and the next one starts: the scheduler skips a blocked task and starts the next candidate (`tick.ts:148-176`). This differs from frame 1 of the mock, where #57 waits in slot 2 for #55.
4. When no task in the queue may start, the lane waits until the next card ends, and the first task that may start then gets "After #55" and a dashed wait from the blocker's end. A task blocked by an issue that is not in the flow (Shaping, skipped, outside the plan) gets "Waits for #N, not in the order" and no card.
5. While the project is held (a failed run, a pending permission request), the header shows "Held" with the reasons from `projectHolds` and the first task in the queue says "Waits for the hold". The layout places cards as if the hold cleared now. While the scheduler is off or paused, the header says "The scheduler is off: tasks start when someone starts them, in this order", and cards are placed the same way.
6. Shaping tasks follow every Ready task, in Project order, as faded cards tagged "Shaping", because the scheduler starts none of them until a person moves them to Ready (open question 6). Done tasks show "Done" and no card.

The layout leaves out the scheduler's "one run planning at a time" rule (`tick.ts:135-136`): planning is short next to a run, and modelling it would put gaps between cards that the person cannot act on.

### 6. Card length is the size's forecast, for order only

A card's length is its task's size forecast in minutes, from `forecastOf` (`apps/web/src/lib/plan/forecast.ts:104`), the same numbers the timeline uses; a task without a size counts as M and its size chip is dashed (open question 5). The axis has no labels and the Flow shows no minutes, hours or dates: lengths only decide which lane frees first. "Next n" is a task's place in the queue, 1 for the first task the scheduler would start, counting blocked tasks; it is what a drag changes.

### 7. Running progress counts graph steps, and a loop can take steps back

A run's total is the number of nodes reachable from its graph version's start node over non-loop edges, without Start and Finish nodes and without gates reached only through an exhausted loop (`onExhausted`, `exhaustedGate`). A node counts as done when its latest execution passed and started after the latest execution of every node before it on non-loop edges.

So when a review loop sends the run back to the coder, the coder and every node after it stop counting until they pass again: "5 of 7 steps" becomes "3 of 7". The card's done share shrinks and its remaining length grows, which is what the loop costs. A run in a branch that a condition skipped ends below its total; it is done when the run ends. The function is pure, in `packages/core/src/graph/progress.ts`, over a `CompiledGraph` and the run's executions ordered by `created_at`.

### 8. Pins are rows in handoff's database

`plan_pins` holds one row per pinned task: project id, issue number, who pinned it (`person` from the dashboard, or the actor of `set_order`), why (`drop`, `keep_here`, `set_order`) and when. Its key is `(project_id, issue)`.

- A person pins by dropping a card, by "Keep it here", and through `set_order`'s `pin` list when they ask an agent to fix a task's place. A person unpins by clicking the pin on the card or the "Pinned" tag in its row; `set_order` unpins through `unpin`. Undo of a drop removes the pin the drop added.
- Optimize and `arrange_plan` never pin and never unpin.
- A pin ends when its task's run starts: `startRun` deletes the task's pins in the transaction that inserts the run. A pin on a task that is closed or no longer in the plan is ignored on read and deleted on the next order write.
- A pin keeps its place number. Every order operation (a drag, a dialog choice, Optimize, `set_order`) puts each pinned task back at its Next number from before the operation and fills the other places with the rest in their new relative order. When tasks ahead of it start, its number falls with the queue (open question 4).

### 9. Order writes go to Project order, one move per displaced task

The client sends the new order of the queue (Ready tasks, then Shaping tasks) with the order it showed. The server reads the Project once with item ids and refuses when the queue there differs from what the client showed: "The order changed on GitHub since the page loaded. The Flow now shows the new order." Otherwise it builds the full new Project order by putting the queue's tasks, in their new order, into the places the queue's tasks held, so epics, stories, closed items, drafts and other repositories' items keep their places. It then keeps the longest run of items already in order and moves each other item with `updateProjectV2ItemPosition` after the item that comes before it in the new order (`afterId` null for the first). A drag moves one task, so it writes one mutation; carrying its dependents writes one more per dependent.

The mutations go through a new port method `moveItems`, batched like `setManyPlanFields`: 20 per request, in order, throwing with the count already written when GitHub refuses part way. A drop writes at once with the timeline's toasts, as estimates Decision 8 does: "Saving the order to GitHub", then "Saved to GitHub in Project order. #74 is pinned." with Undo, or "GitHub did not take the order" with Try again. Undo writes the previous queue back through the same path, with the pins as they were.

### 10. The rule-break dialog is three pure operations on the order

A drop before an open blocker that is still in the queue opens "#62 can't start before #61" with "#61 Story page with its tasks blocks it." and three choices:

- Move to the next free slot (default): the task goes right after the last of its blockers in the queue ("Right after #61, as Next 4.").
- Move #61 earlier too: the task stays where it was dropped, and every open blocker of it that sits later in the queue, with their own blockers, moves to just before it in blocker order ("#61 and #62 become Next 1 and Next 2."). Running and closed blockers do not move.
- Keep it here: the task stays where it was dropped, pinned, with "Waits for #61", a red edge and a red arrow. The layout still starts it after #61 ends.

"Move the tasks that wait on #62 with it", on by default: after the move, every task that #62 blocks, directly or through others, and that now sits before #62 moves to right after it, in its previous relative order. A pinned dependent never moves; it keeps its place and gets the warning. Off: only #62 moves, and a dependent that now starts before it gets "Waits for #62".

A drop that breaks no rule applies at once and pins the card. "Waits for #N" on any task comes from one function, `ruleBreaks(queue, blockers)`: a task placed before an open blocker that is also in the queue.

### 11. Optimize ranks the scope and fills its free places

Optimize works on a scope: the whole queue, or the tasks inside the epics, stories and tasks ticked in the tree (ticking an epic or a story ticks its tasks). Places held by tasks outside the scope and by pinned tasks do not change. The scope's other tasks fill the remaining places, one place at a time from the front: each place takes the highest-ranked task whose blockers in the queue all sit earlier, and when none qualifies the highest-ranked task anyway, which then shows its warning.

Rank, highest first:

1. The longest chain the task sits on: its length plus the longest chain of open tasks it blocks, directly or through others, in forecast minutes.
2. The work it unblocks: the summed lengths of every open task it blocks, directly or through others.
3. Priority, in the Priority field's option order, when the Project has one.
4. Size, larger first (open question 7).
5. Its current place.

This is a list scheduling heuristic for the earliest finish on parallel lanes: critical path first, then the most unblocked work, then largest first. Blockers first is the fill rule, not a rank.

Optimize shows a preview before it writes: "Optimize will move 3 tasks in epic #12 Project management. 1 pinned stays.", the moving cards dashed with their old place outlined and "was 3" in their rows, and Apply and Cancel. Apply writes through Decision 9 with the toast "Optimized epic #12 Project management. Moved 3 tasks. 1 pinned stayed." and Undo.

### 12. `arrange_plan` and `set_order` do the same for agents

In a Flow project `arrange_plan({ project, epic?, story?, issues? })` runs the same Optimize over the same scope rules and returns the moves ("#61 from Next 3 to Next 1"), the pinned tasks it kept, the new queue with each task's lane, and the rule breaks left. It writes nothing. `set_order({ project, order, pin?, unpin? })` writes: `order` lists task numbers in their new relative order, and they fill the places they hold now, as an Optimize scope does. It refuses a pinned task that would move unless `unpin` names it ("#60 is pinned by a person. Arrange around it, or name it in unpin."), a task that is not in the queue, and Priority order. Its approval card lists each move and each pin change. `set_order` takes the same server path as a drop.

### 13. The Flow view keeps the Timeline's rows

The Flow reuses `timelineRows` and `RowLabel` for the left tree, so rows, expansion state, filters and search behave as on the Timeline. The right side is a new grid cell per row with the task's card, a header with one thin strip per lane where every card appears again, the Now line, and the arrows from a blocker's end to its task's start. Ticking in the tree is new: a checkbox per row in the Flow view only, held in client state, with "1 selected" and "Clear the selection" in the toolbar.

Under 640 px the Flow becomes a list in queue order with each task's lane and Next tags, the running cards' steps and the same row tags, and no drag (open question 9).

## Design

### Data model

One migration through `pnpm db:generate`, reviewed and committed:

- `projects.plan_mode text not null default 'flow'` with a check of `plan_mode in ('flow', 'timeline')`. The migration's SQL sets every existing row to `timeline` in the same file (Decision 1).
- `plan_pins`: `project_id uuid not null references projects on delete cascade`, `issue integer not null`, `pinned_by text not null`, `reason text not null` with a check of `drop`, `keep_here` or `set_order`, `created_at`, primary key `(project_id, issue)`.

### Port

`packages/github/src/projects/types.ts`:

```ts
// PlanItem gains:
  /** The item's node id in the Project, for order writes. */
  itemId?: string | undefined;

export type ItemMove = { itemId: string; afterId: string | null };

// ProjectsPort gains:
  /** Moves items in Project order, in the given order, 20 per request; throws naming how many moved when GitHub refuses. */
  moveItems(login: string, number: number, moves: ItemMove[]): Promise<void>;
```

`plan-items.graphql` selects `id` on each item. `plan-mutations.graphql` gains `MovePlanItem` (`updateProjectV2ItemPosition`); `moveItems` builds one document with an aliased mutation per move, chunked by `byMutationCount`. `packages/github/src/projects/order-moves.ts` (pure): `orderMoves(current: string[], next: string[]): ItemMove[]` keeps the longest increasing subsequence and moves the rest in `next` order. `FakeProjects` implements `moveItems` by rebuilding its Map in the new order.

### Pure functions

- `packages/core/src/graph/progress.ts`: `stepProgress(graph: CompiledGraph, executions: { nodeKey: string; status: string; createdAt: Date }[]): { done: number; total: number }` (Decision 7).
- `packages/engine/src/backlog-scheduler/candidates.ts` splits into `orderTasks(items, opts)` (the sort at `:31-39`) and an exported `skipReason`; `candidates` becomes their composition, unchanged in behaviour. A new subpath export `@handoff/engine/candidates` points at this file, which imports only types, so client code can use it.
- `apps/web/src/lib/plan/flow.ts`: `layoutFlow(input: FlowInput): Flow`.
  - `FlowInput`: `tasks` (number, title, kind, status, state, labels, open blockers, position, priority, size, parent), `runs` (issue, run id, created order, `{ done, total }`, what it waits for), `lanes`, `order` and `priorityOptions`, `skipLabel`, `released`, the latest run per issue, `held` (the hold sentences, or none), `pins`, and `minutes` per size.
  - `Flow`: `queue` (task numbers in order, Ready then Shaping), `cards` per task (`lane`, `start`, `end` in minutes from now, `kind` of `running`, `next` or `shaping`, `progress`, `waitsOn`, `after`, `pinned`, `next` place), `rows` per task (the tags of Decision 5), `lanes` (cards per lane), `arrows`, `breaks` from `ruleBreaks`, and `end`.
- `apps/web/src/lib/plan/flow-order.ts`: `moveTo(queue, issue, index)`, `afterBlockers(queue, issue, blockers)`, `blockersFirst(queue, issue, index, blockers)`, `carryDependents(queue, issue, blocks, pins)`, `keepPins(before, after, pins)` and `ruleBreaks(queue, blockers)` (Decisions 8 and 10).
- `apps/web/src/lib/plan/optimize.ts`: `optimize({ queue, blockers, minutes, priorityOptions, pins, scope }): { queue: number[]; moved: { issue: number; from: number; to: number }[]; kept: number[] }` (Decision 11).

### Server

- `apps/web/src/server/flow.ts`: `loadFlow(db, projectId, plan: PlanView)` reads the scheduler's row and holds, the project's active runs with their executions and compiled graph versions, what each waits for (the inputs of `describeNow`), the latest run per issue, released runs and pins, and returns the `FlowInput` for `layoutFlow`. `loadPlan` calls it for a Flow project; the Plan page passes it to the Flow view, and `list_plan` and `arrange_plan` lay it out with `layoutFlow`.
- `apps/web/src/server/flow-order.ts`: `writeOrder(deps, projectId, { shown: number[]; queue: number[]; pin: number[]; unpin: number[]; actor: string })` reads `listItems` once, checks the mode, the scheduler's order and that `shown` matches the queue on GitHub, builds the full order (Decision 9), calls `orderMoves` and `moveItems`, then writes the pin changes in one transaction. Pins are written after GitHub takes the order; a refused write changes no pin.
- `apps/web/src/server/plan-mode.ts`: `planModeOf(db, projectId)` and `refuseInMode(project, mode, sentence)`, used by every handler in Decision 2 and by `shaping.ts`'s `schedule`, `setSizes`, `createStory`, `createTask` and `setupPlan`.
- `packages/engine/src/start-run.ts`: delete the task's `plan_pins` rows in the insert transaction.
- `apps/web/src/server/graphs.ts`: in a Flow project `splitPlan` moves each opened part right after the run's task with `moveItems`, so the parts are next in the queue and not last.

### Web

Written for a designer and an implementer; the design file has the frames and copy.

- Project settings: a "Plan mode" section as in `shell/Settings.dc.html` frame 2, two radio cards with the small pictures, Save and the line about switching. When #491's side menu has landed it sits under Plan at `?tab=mode`; before that it is a `SectionCard` on today's page between Default library and the scheduler. `setPlanModeAction` in `apps/web/src/app/projects/actions.ts`.
- Toolbar: `ViewToggle` shows Tree, Board and the mode's view; `PLAN_VIEWS` gains `flow`; `parsePlanView` maps `timeline` to `flow` in a Flow project and the reverse in a Timeline project, so old links still open. In a Flow project the toolbar's right end has Optimize ("Optimize the whole plan" or "Optimize the 1 selected"), "Flow mode" with its settings icon linking to `?tab=mode` ("Plan mode: Flow. Change it in Project settings"), and Legend.
- `components/plan/plan-flow.tsx`: the grid with `RowLabel` rows, the lane strips ("Slot 1" to "Slot 3"), the Now line and "Held: ..." tag, cards (running with "3 of 7 steps" or "5/7" when narrow, the dashed amber ring while waiting on a person, Ready in blue with the lane number, Shaping faded, the pin square), the arrows, the row tags of the design's copy list, and the hover card with the task's size, place, lane and blockers. `plan-flow-list.tsx` under 640 px.
- `components/plan/use-card-drag.ts`: one-axis pointer drag over the queue's places, with the dashed outline at the old place, the drop line and the tooltip "Next 1, before #58. Lands in slot 3. 3 cards move." computed with `layoutFlow` on the moved queue. Alt and an arrow on a task row move it one place, with one write after the last key press. Running, done, skipped and Shaping cards do not drag.
- `components/plan/rule-break-dialog.tsx`, `components/plan/priority-order-dialog.tsx`, and `components/plan/optimize-preview.tsx` (the banner with Apply and Cancel, the dashed cards and "was 3").
- `useOrderWrites` in `plan-flow.tsx`, the `useMoves` pattern with `writeOrderAction`, its toasts and Undo.
- Accessibility: a card's name says the task, its place and lane ("#58 Plan page tree and board, Next 1, slot 3"); a running card adds its steps; drops, dialog choices and Optimize are announced from the toasts; the tick boxes are checkboxes in the row labels.

### MCP tools and the plugin

- `list_plan` returns `mode`. In a Flow project each task has `place`, `lane`, `pinned`, `waits_for` (blocker numbers), `after`, `skipped`, `progress` (`{ done, total }` while running) and `waits_on`, and the top has `lanes` and `held`; no `start`, `target`, `estimate_hours`, `duration`, `capacity_hours` or `forecasts`.
- `arrange_plan` gains `story` and `issues`, and in a Flow project returns Decision 12's preview. Its description names both modes.
- `set_order({ project, order: number[], pin?: number[], unpin?: number[] })`: confirm, openWorld, idempotent. Its summary lists each move and pin change ("#74 Next 7 to Next 1, pinned").
- `schedule`, `set_size`, `create_story`, `create_task`, `setup_plan` and `go_to_plan` refuse or narrow as in Decision 2; `go_to_plan`'s `view` gains `flow`.
- `get_project` returns `plan_mode`.
- The instructions paragraph at `agent-mcp.ts:42` and the `handoff` skill's "Shape first" describe both modes (Decision 2). `plugins/handoff/.claude-plugin/plugin.json` goes to the next minor version, and `packages/connector/src/plugin.test.ts` checks the skill text and the version.

## Delivery

Each PR is one GitHub issue, one branch, CI green, one red-green slice per test named here, `pnpm doctor:react` clean after changes under `apps/web`, and Context7 before code against Next.js, Drizzle, Zod, Octokit or Vitest. PRs 1, 2 and 3 are independent; 4 needs 3; 5 needs 1, 2 and 3; 6 needs 5; 7 needs 4 and 6; 8 needs 7; 9 needs 1, 4 and 5; 10 comes last. PR 1's settings section waits for #491's side menu when that lands first; otherwise PR 1 adds a card and #491 moves it.

1. **Plan mode setting.** Files: `packages/db/src/schema/projects.ts` and a migration, `apps/web/src/server/plan-mode.ts`, the project settings page, `components/projects/plan-mode-settings.tsx`, `app/projects/actions.ts` (`setPlanModeAction`), `agent-mcp.ts` (`get_project`). First tests: `apps/web/src/server/project-admin.integration.test.ts` addition "a project added after the migration plans in Flow mode, and the check refuses another mode"; `app/projects/actions.integration.test.ts` addition "setPlanModeAction stores Flow or Timeline and keeps Start, Target and Project order on GitHub"; `plan-mode-settings.test.tsx` "the Plan mode section shows Flow and Timeline as radio cards and Save writes the picked mode"; `agent-mcp.integration.test.ts` addition "get_project returns the plan mode".

2. **Port: item ids and order writes.** Files: `packages/github/src/queries/{plan-items,plan-mutations}.graphql`, codegen output, `projects/{types,octokit-projects,order-moves}.ts`, `testing/fake-projects.ts`. First tests: `order-moves.test.ts` (pure) "moving one task to the front is one move after nothing"; "items already in order are not moved and each moved item goes after its new predecessor"; "applying the moves to the current order gives the next order". `octokit-projects.test.ts` additions "listItems returns each item's id"; "moveItems sends the moves in order, 20 per request"; "a refusal part way throws naming how many moved". `fake-projects.test.ts` addition "moveItems reorders listItems". Manual step on the PR: on a throwaway Project, move items with chained `afterId` in one request and record that GitHub applies them in order, that the table view without a sort shows the new order, that a drag in GitHub's table changes POSITION, and the `rateLimit { cost }` of `PlanItems` with `id`.

3. **Flow layout (pure).** Files: `packages/core/src/graph/progress.ts`, `packages/engine/src/backlog-scheduler/candidates.ts` and the `./candidates` export, `apps/web/src/lib/plan/flow.ts`. First tests: `packages/core/src/graph/progress.test.ts` "the total counts nodes reachable over non-loop edges without Start, Finish and exhausted gates"; "a node is done when its latest execution passed after every node before it"; "a loop back to the coder takes the coder and the nodes after it out of done". `candidates.test.ts` addition "candidates is orderTasks then skipReason, in Project and in Priority order". `apps/web/src/lib/plan/flow.test.ts` "active runs take lanes, oldest first, and straddle Now by their done share"; "the next task in order takes the lane that frees first"; "a blocked task is passed over for the next one, as the scheduler does, and starts once its blocker's card ends"; "a lane with no startable task waits for the next card to end and the task says After #55"; "skipped tasks keep their row and are not in the order"; "Shaping tasks follow every Ready task"; "a task without a size counts as M"; "more active runs than lanes keep their own lanes until they end"; "a hold puts Waits for the hold on the first task"; "the flow's order of Ready tasks without blockers equals candidates()".

4. **Order operations and Optimize (pure).** Files: `apps/web/src/lib/plan/{flow-order,optimize}.ts`. First tests: `flow-order.test.ts` "next free slot puts the task right after its last blocker in the queue"; "blockers first moves the open blockers, with their own blockers, to just before the task"; "keep it here leaves the task where it was dropped and ruleBreaks names its blocker"; "carrying dependents moves the tasks it blocks that now sit before it to right after it, in their order"; "a pinned dependent is not carried and gets the warning"; "keepPins puts each pinned task back at its place number". `optimize.test.ts` "blockers come before the tasks they block"; "the longest chain goes first, then the most unblocked work, then priority, then the larger size"; "pinned tasks and tasks outside the scope keep their places"; "the result lists each moved task with its old and new place".

5. **Pins and order writes.** Files: migration (`plan_pins`), `packages/db/src/schema/plan-pins.ts`, `packages/engine/src/start-run.ts`, `apps/web/src/server/{flow,flow-order}.ts`, `server/plan.ts`, `app/projects/actions.ts` (`writeOrderAction`, `unpinAction`). First tests: `server/flow-order.integration.test.ts` (real Postgres, `FakeProjects`) "writeOrder moves the dragged task in Project order with one move and pins it"; "epics, stories and closed items keep their places"; "a queue that changed on GitHub is refused and nothing is written"; "Undo writes the previous order and removes the pin"; "a refused GitHub write changes no pin"; "Priority order is refused with the sentence". `start-run.integration.test.ts` addition "starting a run on a pinned task removes its pin". `server/flow.integration.test.ts` "loadFlow gives each active run its steps done of the graph's steps and what it waits for"; "loadFlow reads lanes from max_runs, or 1 without a scheduler row, and the holds".

6. **The Flow view.** Files: `lib/project-tab.ts`, `lib/paths.ts`, `components/plan/{plan-toolbar,plan-tab,plan-flow,plan-flow-list}.tsx`, the Plan page, `server/scheduler-card.ts` (Next places from the flow in a Flow project). First tests (web): `plan-toolbar.test.tsx` additions "a Flow project's toggle is Tree, Board and Flow, with no Timeline"; "Flow mode links to the Plan mode settings". `plan-flow.test.tsx` "each task's card sits on its row in its lane, with its Next tag"; "a running card shows its steps and a run waiting on a person has the dashed ring and the row says what it waits for"; "a blocked task shows After #55 and an arrow from its blocker"; "skipped tasks show their reason and Not in the order"; "the lane strips repeat each card"; "a held scheduler shows Held with its reasons". `plan-flow-list.test.tsx` "under 640 px the Flow is a list in order with lane and Next tags". `project-tab.test.ts` addition "view=timeline opens Flow in a Flow project".

7. **Drag, the dialogs, pins and Undo.** Files: `components/plan/{use-card-drag,rule-break-dialog,priority-order-dialog}.ts(x)`, `plan-flow.tsx`. First tests (web): `plan-flow.test.tsx` additions "dragging a Ready card shows where it lands and how many cards move"; "a drop saves the order, pins the card and the toast's Undo writes the old order back"; "a refused write puts the card back and offers Try again"; "a drop before a blocker opens the dialog with Move to the next free slot picked and the checkbox on"; "each choice gives the order its operation computes"; "clicking the pin unpins the card"; "Alt and an arrow move a task one place with one save after the last key"; "running, done, skipped and Shaping cards do not drag"; "under Priority order a drop asks to switch to Project order".

8. **Optimize.** Files: `plan-flow.tsx` (tick boxes), `components/plan/optimize-preview.tsx`, `plan-toolbar.tsx`. First tests (web): `plan-flow.test.tsx` additions "ticking an epic ticks its stories and tasks and the toolbar says 1 selected"; "Optimize previews the moves with their old places and writes nothing until Apply"; "Apply writes the order and the toast's Undo restores it"; "pinned cards and tasks outside the selection keep their places".

9. **Agent paths per mode.** Files: `lib/assistant/catalog.ts`, `server/agent-mcp.ts` (handlers and instructions), `server/shaping.ts`, `server/graphs.ts` (`splitPlan`), `lib/assistant/ui-tools.ts`, `plugins/handoff/skills/handoff/SKILL.md`, `plugins/handoff/skills/handoff-setup/SKILL.md`, `plugins/handoff/.claude-plugin/plugin.json`. First tests: `agent-mcp.integration.test.ts` additions "schedule in a Flow project refuses and names arrange_plan and set_order"; "set_order in a Timeline project refuses"; "set_size in a Flow project sets a size and refuses an estimate"; "create_task with dates in a Flow project refuses and writes nothing"; "setup_plan in a Flow project adds Size and no date or Estimate field"; "list_plan in a Flow project returns places, lanes, pins and progress and no dates or hours"; "arrange_plan in a Flow project returns the optimized order with its moves and kept pins, and writes nothing"; "set_order writes the order, pins what pin names, and refuses to move a pinned task unless unpin names it". `plan-split.integration.test.ts` addition "in a Flow project a split's parts land right after the run's task in Project order". `ui-tools.test.ts` addition "go_to_plan with view timeline in a Flow project refuses". `catalog.test.ts` addition "set_order is confirm and its summary lists each move and pin". `packages/connector/src/plugin.test.ts` additions "the handoff skill says a Flow project has no dates and names arrange_plan and set_order"; the version check.

10. **Docs.** Files: `GLOSSARY.md` (Plan mode, Flow, Lane, Pin, Optimize; Project order now written by handoff), `docs/adr/0007-github-projects-is-the-plan-store.md` (pins and the plan mode are handoff data; order lives in Project order), `docs/plans/estimates.md` and `docs/plans/scheduler.md` (a note that a Flow project uses neither dates nor Arrange by estimate, with a link here), `README.md` (the Plan section).

## Risks

| Risk | Mitigation |
|---|---|
| GitHub applies chained position moves out of order, so a multi-move write lands wrong | PR 2's manual step checks it first; if it fails, `moveItems` sends one request per move, and Optimize's preview says how many requests it takes. |
| The page's queue is stale when a person drags (a run started, someone reordered on GitHub) | `writeOrder` compares the queue the page showed with GitHub's and refuses with the sentence; the refresh shows the new order. |
| A drop writes half the moves and GitHub refuses the rest | The error names how many moved; the Flow shows what the next read has; Undo writes the order it saved before the drop. |
| The Flow and the scheduler disagree about what starts next | `layoutFlow` uses `orderTasks` and `skipReason` from the scheduler's own file, and a test checks the order against `candidates()`. |
| Lengths from forecasts make the flow look precise | No times or hours show; the legend says "Length follows the size: S, M or L. Flow has no dates." |
| A loop makes a running card's steps go back | Decision 7 makes that the rule, so the card tells what the loop cost. |
| Many pins make Optimize move almost nothing | The preview says how many pins stayed; a click unpins. |
| An agent in a Flow project still proposes dates from old habits | Every date path refuses in Flow mode with the way forward, and the instructions and skill say so. |
| Under Priority order dragging seems broken | The drop opens the switch dialog instead of failing quietly. |
| The secondary rate limit trips on a large Optimize | 20 mutations per request with Octokit's one second spacing, as `setManyPlanFields` does today. |

## Open questions

Each has a recommended answer; unanswered, the implementation takes the recommendation. The design's seven open questions are answered by the user's decisions or below.

1. Which mode does a project start in? Recommended: existing projects stay in Timeline, and projects added after this lands start in Flow.
2. Lanes when the Claude cap is lower than `max_runs`. Recommended: lanes follow `max_runs`, since the scheduler starts that many runs, and the header shows the Claude slots next to it. The alternative is the smaller of the two.
3. Does a run in review keep its lane? The mock says no ("In review, no slot"). Recommended: yes, because the scheduler counts it toward `max_runs`, and a Flow that frees the lane would start tasks the scheduler will not start yet.
4. When cards ahead of a pinned card move, does the pin keep its number or its neighbour? Recommended: its number (Decision 8).
5. A task without a size. Recommended: it counts as M, with a dashed size chip.
6. Shaping tasks in the Flow. Recommended: faded cards after every Ready task, tagged "Shaping", so the path shows while it is shaped. The alternative is no card until Ready.
7. Size as Optimize's last rank. Recommended: larger first, the usual rule for the earliest finish on parallel lanes.
8. The mock places a blocked task in a lane to wait for its blocker; the scheduler starts the next task instead. Recommended: the Flow follows the scheduler (Decision 5), and the mock's dashed wait shows only when no task may start.
9. Phone width. Recommended: a list in order with lane and Next tags and no reordering.
10. Should agents be able to pin? Recommended: only through `set_order`'s `pin` list, when the person asks for a task's place to stay; Optimize and `arrange_plan` never pin.

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

1. Open Project settings, Plan mode. Expect Timeline picked, since todooverkill existed before the migration. Pick Flow and save. Expect the Plan page's toggle to show Tree, Board and Flow, and `get_project` to return `plan_mode: flow`.
2. Open Flow. With the scheduler at `max_runs` 2, expect two lanes, each active run on a lane with its steps, and the Ready tasks in Project order with Next tags matching the scheduler card's next tasks.
3. Drag the last Ready card to the front. Expect the tooltip, then "Saved to GitHub in Project order", the pin, and with `gh api graphql` the item first among the tasks in Project #5's items. Press Undo: expect the old order on GitHub and no pin.
4. Drop #143 before #142, which blocks it. Expect the dialog. Pick Move #142 earlier too: expect both ahead, in blocker order, with no warning. Undo, drop again and pick Keep it here: expect "Waits for #142", the red edge, and the card still placed after #142's card.
5. Tick epic #122 and press Optimize. Expect the preview naming the tasks that move and the pinned ones that stay, nothing on GitHub before Apply, and after Apply the new order on GitHub with Undo restoring it.
6. Switch the scheduler to Priority order (on a Project with a Priority field) and drag a card: expect the switch dialog.
7. In Claude Code with the updated plugin, ask to plan the timeline of todooverkill. Expect `schedule` to refuse with the sentence and the agent to use `arrange_plan` and propose `set_order` with one approval card.
8. Start a run on a pinned task: expect the pin gone and its card on a lane. Let a review loop send it back to the coder: expect its steps to drop.
9. Switch todooverkill back to Timeline. Expect the Timeline with the dates it had, and the order unchanged on GitHub.
10. With `gh api rate_limit` before and after ten drops and one Optimize of five tasks: expect one `PlanItems` read and one mutation request per drop, and one read and one request for the Optimize.
