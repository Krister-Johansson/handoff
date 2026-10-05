# handoff

handoff runs coding agents as a graph. You draw the steps once (plan, code, test, review, pull request, merge), and each run walks that graph against a GitHub repository. Every step has a contract that the engine checks before moving on, and failures loop back with the evidence: failing test output, review comments, CI logs. When an agent needs a decision it asks you in the inbox and waits.

Claude nodes run the Claude Code CLI on your own Claude subscription. There is no API key involved.

## What you need

- Node 24 and pnpm 12
- Docker (for Postgres, and optionally for running each run in a container)
- The Claude Code CLI, version 2.1.285 (`claude --version`)
- A Claude Pro, Max, Team or Enterprise subscription
- The GitHub CLI (`gh`), logged in, for the token and the webhook relay

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

Then fill in `.env`:

1. **Claude.** Run `claude setup-token` and put the token in `CLAUDE_CODE_OAUTH_TOKEN`. It lasts a year. Do not set `ANTHROPIC_API_KEY`: handoff removes it from the Claude process so runs stay on your subscription.
2. **GitHub.** For personal use, set `GITHUB_TOKEN` (the output of `gh auth token` works). For a team setup, create a GitHub App instead and set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH`. The App needs read and write access to contents and pull requests, read access to checks and actions, and the events `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `check_suite`, `check_run` and `workflow_run`. For the Plan's activity line, also give it read access to issues and the events `issues`, `sub_issues` and `issue_dependencies`. The Plan itself needs `GITHUB_TOKEN` even with an App (see The Plan).
3. **Webhooks.** Set `GITHUB_WEBHOOK_SECRET` to a random string, for example the output of `openssl rand -hex 32`.

The dashboard reads the same `.env` through `apps/web/.env.local`, which is a symlink to it.

## Running

Start these in separate terminals:

```bash
pnpm dev:web                      # dashboard on http://localhost:3000
pnpm dev:worker                   # runs the graphs
pnpm dev:webhooks owner/repo      # optional: relays that repository's webhooks to the dashboard
```

The webhook relay uses GitHub's `gh webhook` extension (`gh extension install cli/gh-webhook`). GitHub delivers the events to your machine, so nothing is exposed to the internet. Without it, a waiting pull request is re-checked every 10 minutes instead of within a second. Stop the relay with Ctrl-C so it removes its temporary hook from the repository.

The dashboard has no login and listens only on 127.0.0.1. Keep it that way.

## Your first run

1. Open **Projects**, press **Add project** and pick the repository. The project is named after it. Use a throwaway repository first.
2. Create a graph from the template **Plan, code, test, review, PR, merge with retry loops, and a demo and Try it for UI changes**.
3. In the editor, select the **Test** node and set its command to whatever proves the change works in that repository, for example `npm test`. Save.
4. Press **Run**, describe the task, and watch the run page.

The same flow from a terminal:

```bash
pnpm handoff project add --name sandbox --repo owner/name
pnpm handoff graph import --project sandbox --name loop packages/core/src/templates/loop.graph.json
pnpm handoff run --project sandbox --graph loop --task "Add a CONTRIBUTING.md" --follow
```

To look around without GitHub or Claude, `pnpm demo` seeds a demo run with simulated Claude output, and `pnpm demo:reset` removes it again.

## How a run works

- **Issues.** A run can link GitHub issues (New run, or `pnpm handoff run --issue 12`). The agents read their bodies, the pull request says `Closes #12`, and the Merge node closes them once the pull request merges.
- **Graph.** Nodes and edges stored as graphology JSON. Each save is a new version, and a run keeps the version it started with.
- **Nodes.** Planner, Coder and Reviewer run Claude. Tester runs a shell command with a minimal environment (`PATH`, `HOME`, locale and `CI=true`, never the worker's tokens or `DATABASE_URL`), because it runs code the agent wrote. List any other variables its tests need under **Environment variables** in the node's settings; the graph stores the names and the worker supplies the values. handoff's own secrets cannot be listed. The PR node pushes the branch, opens the pull request, posts the Reviewer's comments on it as one comment (updated on later attempts), and waits for CI and reviews. Merge squash-merges. A Human gate asks you something.
- **Demo and Try it.** A Demo node starts the run's app from the repository's `.claude/launch.json` (the configuration named `handoff-demo` when there is one, else the first, so a project can demo its production build), or, in a repository without the file, as Project settings, App launch says, and has Claude walk through the acceptance criteria in a headless browser. Set to **only for UI changes**, as in the loop and plan templates (the linear template has no demo), a demo skips a change that touches none of the project's UI paths (Settings, Projects; empty means routes, pages, components and styles) and leaves through `skipped`, past the Try it gate to the pull request. Only one of the two edges into the pull request node is taken, so in those templates its join mode is `any` (see Joins). The project's demo seed command runs after the compose services start and before the app. The demo's **Environment variables** reach the seed command and the app as the Tester's do. A browser console error fails the demo; the Try it page lists the console's and the server log's warnings and errors, marking those the project's previous demo did not have as new.
- **App launch.** Project settings has an App launch section in its Runs group. When the repository has `.claude/launch.json` on the default branch, the section shows the configuration handoff starts, read-only, since the file wins. Without the file, the section holds the same values as one configuration: the command on one line, the working directory, the port with Any free port, Opens at and environment values. Environment values are stored as plain text, so do not put secrets there. Test start starts the app from a fresh worktree of the default branch with the form's values, saved or not, runs the setup command, the compose services and the seed command first, shows each step with its time, and stops the app after 10 minutes. Copy as launch.json gives the form as a file to commit.
- **Contracts.** Every node returns structured output that must match its schema, and can have deterministic checks such as "tests pass" or "changes stay within the paths the plan claimed". The engine runs the checks, not the model.
- **Loops.** An edge can loop back, for example from a failed test run to the Coder, with a maximum number of attempts. The Coder gets the failing output in its context. When a loop runs out, the run asks you in the inbox whether to retry or stop.
- **Joins.** A node that several edges lead to, not counting loop edges, needs a join mode, which the inspector sets under Edges as Join. `all` waits until every one of those edges has arrived, for branches that all run. `any` starts the node at the first edge and ignores the later ones, for branches of which only one is taken, such as a skipped demo and the Try it gate. Without a mode, a node fed by branches that exclude each other waits forever. The graph editor, the assistant, `handoff graph import` and new graphs from a template refuse a graph with such a node and no mode, and name the node. A version saved before this rule still runs, with `all` for a node without a mode.
- **Waiting.** A node that waits for CI, a review or your answer holds no process. Webhooks, or the periodic re-check, wake it.
- **Permissions.** When a Claude step calls a tool its allow rules do not cover, the inbox asks you to allow or deny the call. Always allow covers the node's matching calls for the rest of the run. While the request waits, the step gives up its Claude slot to other steps. If nobody answers within the project's permission timeout, the call is denied and the step goes on without it. The timeout is 10 minutes by default; change it, from 1 to 120 minutes, with Edit in **Settings, Projects**. While a request waits, the run's status stays `running`. `pnpm handoff runs` prints `waiting on permission (coder)` in its place, the dashboard's run lists and the run page show the status as "waiting on permission", and `list_runs` and `get_run` add `waiting_on: { kind: "permission", step: "coder", since: "<time>" }` next to `status` (`null` when the run waits on no request).
- **Recovery.** A failed node can be repaired in place from the inbox or with `pnpm handoff run repair`. Everything before it is kept. Rate limits are retried automatically with backoff.

### Several issues in one run

A run can link more than one issue, for example `start_run` with issues `[16, 88]`. The run has one branch and opens one pull request for all of them.

- Each issue is checked on its own before the run starts: a planned task must be Ready, it must not be blocked on GitHub, and no other active run may hold it. If any issue fails a check, the whole start is refused.
- The planner reads every issue's body, comments, story and epic, and writes one plan for all of them.
- Each linked task moves to Running when the run starts, to In review when the pull request opens, and to Done when it merges. Cancelling the run puts each task it moved back to the Status it had before.
- The pull request says `Closes #N` for each issue, and the Merge node closes every linked issue itself. When that closes the last open task of a story, it closes the story too, and then the epic in the same way (see Finished stories and epics under The Plan).
- The Plan shows the same run on each of its tasks.

Known limits, to address when a real project needs them:

- The scheduler starts one task per run. Only a person groups issues.
- A run cannot drop one of its issues. If only some of them should ship, cancel the run and start separate runs.
- An issue blocked by another issue in the same run is still refused at start, although both would ship in one pull request.

The library holds skills, MCP servers and subagents that nodes enable by name. In the dashboard it is the Library group of **Settings**: Skills, Agents, MCP servers and Groups. A project's graphs are listed in its **Project settings**, under Graphs, and each opens in the graph editor. MCP secrets are written as `${secret:NAME}` and resolved from the worker's environment when a node runs. They are never stored in the database. Git gets the GitHub token through `GIT_CONFIG_*` environment variables, so it does not appear in error messages or the process list, and error messages and command output are scrubbed of token-shaped strings before they are stored.

## The Plan

A project can keep a plan of epics, stories and tasks on GitHub. GitHub holds the whole plan, including the order of the work. handoff stores the number of the GitHub Project that belongs to the handoff project, and three things GitHub has no field for: the plan mode (see Plan mode), the capacity the timeline uses (see Sizes and estimates) and the Flow's pins (see Pins).

- **Hierarchy.** Epics, stories and tasks are issues in the project's repository. A story is a sub-issue of its epic and a task is a sub-issue of its story. The labels `epic`, `story` and `task` mark the kind.
- **Status.** Each task has a Status on a GitHub Project (v2) of the repository's owner, a user or an organization, with the options Shaping, Ready, Running, In review and Done. A closed issue counts as Done whatever its Status says.
- **The Ready gate.** Of the issues in the Project, only open tasks in Ready that no run works on reach the backlog and `list_backlog`. Tasks blocked by an open issue are listed last, and a run will not start on them until the blocker closes. Epics and stories never run. Issues that are not in the Project stay in the backlog as unplanned and can still be started.
- **Status from runs.** handoff sets Running when a run starts on a task, In review when the pull request opens and Done when it merges. A task that joins the plan while a run works on it gets the run's Status. Each write is a `plan.status` event on the run, and a write that moves a task onto the run's Status records the Status the task had in `from`. Cancelling a run, or stopping it after a loop ran out, puts each task it moved back to that Status: a task the run started on goes back to Ready, and a task that was in Shaping when it joined the plan goes back to Shaping. A task the run never moved keeps its Status, and so does a task a newer run links. A write that cannot happen is a `plan.skipped` event and the run carries on.
- **Finished stories and epics.** When a run's merge closes the last open task of a story, handoff closes the story and sets its Status to Done. When that story, or a task directly under the epic, was the epic's last open sub-issue, handoff closes the epic and sets it to Done too. The comment on each closed story or epic names the pull request and the run, for example "Finished by #88, merged by handoff run `<id>`, which closed #57, its last open sub-issue." The Done write is a `plan.status` event on the run with the Status the story or epic had in `from`; cancelling a run never puts it back. A story or an epic with an open sub-issue stays open. Only an issue the merge closed counts: a task closed by hand before the merge, or a run cancelled before it merged, closes no story. This works the same in a Flow and a Timeline project and for a Project of a user or an organization, and a repository without a plan Project still gets its stories and epics closed on GitHub. A close that fails is a `github.parent_close_failed` event and the merge still passes.

### The token

The Plan needs `GITHUB_TOKEN` to be a classic token with the `project` scope. The same token reaches the Projects of users and of organizations. Add the scope and use the token:

```bash
gh auth refresh -s project
GITHUB_TOKEN=$(gh auth token)   # put this value in .env
```

A fine-grained token cannot reach a Project owned by a user account. A GitHub App cannot either: GitHub has a Projects permission only for organizations, and no App permission covers a user's Projects. handoff reads every Project, a user's or an organization's, with the one classic token. With only an App, or with a token that lacks the scope, the Plan page and the shaping tools say what is missing, and runs record `plan.skipped` instead of moving tasks.

GitHub can still refuse the token for an organization's Project. handoff learns of it only when it reads that Project, and then names the reason:

- SAML single sign-on. An organization with SSO needs the token authorized for it. GitHub's answer carries an authorization URL, and handoff says that the organization uses SAML single sign-on and the token is not authorized for it, with the URL to open within the hour, or the way on GitHub: Settings, Developer settings, Personal access tokens, Configure SSO.
- Classic tokens refused. An organization can refuse classic personal access tokens. handoff says that the organization does not accept them and that an organization owner can allow them in the organization's settings under Personal access tokens, Settings, Tokens (classic).
- A missing scope. handoff names the scope GitHub asks for and gives the two commands above.

For SSO and refused classic tokens the Plan page shows the sentence under "GitHub refused GITHUB_TOKEN for this plan". For a missing scope it shows "GitHub Projects need the project scope" with the two commands. `setup_project`'s plan check, `start_scheduler` and the shaping tools answer with the same sentence, and a run records it as the reason of its `plan.skipped` event.

### Linking a Project

Ask the assistant, or Claude Code with the handoff plugin, to set up the plan. That calls `setup_plan`, which shows an approval card first. It creates the labels `epic`, `story` and `task` if they are missing. The plan's Project belongs to the repository's owner, a user or an organization. With `use` and the number of one of the owner's existing Projects, it links that Project to the repository and gives it the Status options Shaping, Ready, Running, In review and Done. An option whose name matches apart from case or an emoji is renamed, a missing one is added, and every other option stays, so no card loses its column. `list_github_projects` lists beforehand the owner's Projects that the token can write, those linked to the repository first, with the options each one lacks, and the result of `setup_plan` names each option it renamed or added. Without `use`, it creates a Project called "<project name> plan" under the repository's owner with those options and links it. Both ways the Project gets a single select field Size with the options S, M and L. In a Timeline project it also gets the date fields Start and Target and a Number field Estimate; a Flow project uses none of them and gets Size only. On a Project that already has a Size field, `setup_plan` adds S, M and L and keeps the field's other options. GitHub's roadmap layout reads Start and Target once you pick them under "Date fields" in a Roadmap view; the API cannot set that. Either way it stores the Project's number on the handoff project. Running it again on a project that has a plan adds missing labels and the missing fields its plan mode uses, and reports what it found.

In an organization your GitHub account must be allowed to create Projects; when it is not, `setup_plan` says so before it creates anything, and an organization owner can allow it or create a Project for you to pick with `use`. The result's `project.owner` gives the owner's login and its type, User or Organization. handoff sets no issue type. In an organization's repository a kind label wins over the issue's type; without a kind label a type named like a kind decides, so an issue typed Task is a task, and any other type, such as Bug or Feature, leaves the kind to the issue's depth in the sub-issue tree.

### Plan mode

A project plans in Flow mode or in Timeline mode. In Flow mode the plan is an order of tasks and their blockers, with no dates and no hours (see The Flow). In Timeline mode items have Start and Target dates and tasks have sizes and estimates (see The timeline). A project added to handoff starts in Flow mode. A project that existed before plan modes plans in Timeline mode.

Project settings has a Plan mode section in its Plan group, with Flow ("Order, no dates"), Timeline ("Dates and estimates") and Save. Only a person changes the mode. No MCP tool writes it; `get_project` returns it as `plan_mode` and `list_plan` as `mode`. Switching writes nothing to GitHub: Start, Target and Estimate stay on the items, and Project order stays as it is. A project switched back to Timeline shows the dates it had. Switching does not add fields either. A plan set up in Flow mode has Size only, so after a switch to Timeline the Project has no Start, Target or Estimate to read or write, and the timeline tools do not say so yet (issue #587). Run `setup_plan` again, or use Add the fields in Settings, Projects, to add them.

The Plan page's toolbar has Tree, Board and the mode's own view, Flow or Timeline, with no switch between the two. A link with `?view=timeline` opens the Flow in a Flow project, and `?view=flow` opens the timeline in a Timeline project. The scheduler works the same in both modes.

The agents follow the mode. The MCP server's instructions and the `handoff` skill tell them to set only the order and the blockers in a Flow project, and to set dates only in a Timeline project when you ask to plan the timeline. A tool that belongs to the other mode refuses with a sentence that names what to use instead, and writes nothing:

- In a Flow project, `schedule` refuses, `create_story` and `create_task` refuse `start` and `target`, `set_size` refuses an estimate, and `go_to_plan` refuses the timeline view. For example: "todooverkill plans in Flow mode: tasks have an order and blockers, no dates. Use arrange_plan and set_order, or a person can switch the plan mode in Project settings."
- In a Timeline project, `set_order` refuses, and `go_to_plan` refuses the flow view.

The planner proposes a size in both modes and never a date. In a Flow project, when a run splits its plan, the issues it opens for the later parts land right after the run's task in Project order, so they come next in the queue.

### Shaping

The assistant and the Claude Code plugin shape the plan with these tools. Every one that writes to GitHub shows an approval card first, or the permission prompt in Claude Code.

- `list_plan` shows the tree: epics, their stories, their tasks, each with its status, and each task with its open blockers, latest run and pull request, its size and the size its planner proposed, plus the open issues outside the plan. `mode` says the plan mode. In a Timeline project each item also has its Start and Target dates, each task its estimate and duration, and the result gives the project's capacity and each size's forecast. In a Flow project there are no dates or hours. The result gives the queue, the number of lanes, the scheduler's order and what holds it. Each task has its place in the queue, its lane, whether it is pinned, the blockers it waits for, the blocker its lane waits for, why the scheduler skips it, and while it runs, its steps and what it waits on. Each item has its milestone, its own or the one it inherits with `inherited_from`, and the result lists the repository's milestones with the tasks in each done of total (see Milestones).
- `create_epic` creates an issue labelled `epic` with its goal. `create_epic`, `create_story` and `create_task` take `milestone`, an open milestone of the repository by number or title, and refuse a closed or unknown one before they create anything.
- `create_story` creates a sub-issue of an epic labelled `story`, with its acceptance criteria as checkboxes.
- `create_task` creates a sub-issue of a story labelled `task`, with its brief, optional criteria, the issues it is blocked by and an optional size. In a Flow project the blockers are what orders the work.
- `plan_issue` brings an issue from outside the plan in as a task, optionally under a story.
- `move_to_ready` moves tasks to Ready. It refuses an epic, a story, a closed issue and a task without a body.
- `move_to_shaping` moves tasks back to Shaping. It refuses a task that an active run works on.
- `schedule` sets, moves or clears the Start and Target dates of epics, stories and tasks, each with its own dates. It refuses a Target before its Start, a date not written YYYY-MM-DD, an issue outside the plan and a Project without the date fields, and then changes nothing. The assistant proposes dates only when you ask it to plan the timeline. `create_story` and `create_task` also take `start` and `target`. A Flow project refuses `schedule` and those dates.
- `set_size` sets or clears the size and the manual estimate of tasks. An estimate is hours or days (`3h`, `2d`) or a number of hours, and 0 or null clears it. A task with a Start gets the Target its new duration ends on. It refuses an epic, a story, an issue outside the plan, an estimate it cannot read or outside 0 to 1000 hours, and a Project without the Size and Estimate fields, and then changes nothing. A Flow project takes sizes only and refuses an estimate.
- `arrange_plan` writes nothing. In a Timeline project it returns where the unscheduled tasks with a size or an estimate fit, as Arrange by estimate on the timeline places them, and the tasks left out because they need a size; the assistant then proposes those dates in one `schedule` call. In a Flow project it returns Optimize's preview: the order now, each task that moves with its old and new place, the pinned tasks it kept, the new queue with each task's lane, and the tasks still placed before a blocker. With `epic`, `story` or `issues`, it arranges only the tasks inside them.
- `set_order` writes a new order of a Flow project's queue to Project order. `order` lists tasks in their new order, and they fill the places they hold now, so every other task keeps its place. `pin` pins tasks at their new place, which the assistant does only when you ask for a task's place to stay, and `unpin` removes pins. It refuses a Timeline project, a scheduler that starts by Priority, a task outside the queue, a Shaping task in a Ready task's place, a queue that changed on GitHub since it was read, and a pinned task that would move unless `unpin` names it. Its approval card lists each move and each pin change.
- `set_milestone` sets the milestone of epics, stories and tasks, by its number or title, or clears it with `null`. On an epic or a story it sets that issue only, and the items under it without a milestone of their own inherit it. It refuses a closed or unknown milestone and names the open ones, and it refuses an issue outside the plan and an issue named twice, and then changes nothing. It needs GitHub access and works in both plan modes.

Everything created starts in Shaping. `setup_project` reports whether the plan is in place.

### The timeline

In a Timeline project the Plan page shows the plan as a tree, a board or a timeline. The timeline draws a bar for each item from its Start to its Target, with each run of a task as a strip under its bar, arrows from blocked-by links, and flags for late, blocked and overdue items. A story or an epic without dates of its own spans its tasks, drawn dashed. Items without dates are listed under Unscheduled, each with Schedule. The zooms are Days, Weeks and Months, and the zoom is part of the page's URL. Under 640 px the timeline is a list.

### Sizes and estimates

A task has a size, S, M or L, in the Project's Size field, and in a Timeline project it can have a manual estimate in its Estimate field. A Flow project uses sizes only, with no estimates and no capacity. The size chip on each task in the tree, on the board and on the timeline opens the size popover. In a Flow project the chip shows the size letter only, with no time. Picking S, M or L saves it to GitHub at once. In a Flow project the popover has only the sizes. In a Timeline project it also shows each size's forecast, and under Manual estimate you pick 1h to 2d or type hours or days, such as `5h` or `1.5d`, and Enter saves it. Use the forecast clears the estimate, and so does 0. GitHub stores the estimate in hours. A story, an epic and a board column show the sum of their tasks, starting with `~` when part of it is a forecast and ending with `+n` for tasks that have neither a size nor an estimate. In a Flow project they count the sizes instead, such as "2 S, 1 M, 1 unsized", and show nothing when no task has a size.

A size's forecast comes from this project's finished runs: the median wall time of the succeeded runs of that size that link one task, split into agent time, queue time and time waiting on you, with the median reported cost and the number of runs. A size with fewer than 5 runs uses its default, S 30m, M 1h and L 2h. A run records the Size its task had when it started; a run without one counts under its planner's proposal, else under its task's current Size.

The planner proposes a size in its plan. A task without a Size shows, dashed, the proposal of its latest run that has one, and the popover offers Use with that size, such as Use M. Only that press writes the proposal to GitHub. A task with a Size ignores proposals.

A task's duration is its estimate, else the forecast of its Size, else the forecast of its planner's proposal. A task without a duration keeps a bar from Start to Target.

The capacity is the hours you work on the plan a day: 6 unless you change it, from 1 to 24. A day in an estimate is the capacity, so `2d` at 6 hours a day is 12 hours. A sized task's bar runs from its Start for its duration over the capacity, so at 6 hours a day a 9 hour task covers a day and a half. Every day counts, weekends too. Tasks that start on the same day sit one after another, in blocked-by order and then by issue number, and a task whose blocker ends on its Start day starts after the blocker's last hour. Its Target is the day its hours end. handoff writes that Target to GitHub when you drop the bar, change its size or estimate, or save Arrange. When the Target on GitHub differs, for example after a change of the capacity, the bar's hover card shows both, and Overdue uses GitHub's.

The load row under the dates shows the planned hours of each day against the capacity, red on a day over it. Its label, "Load at 6h a day", opens the capacity popover.

Project settings has an Estimates section in its Plan group. It holds the capacity with Change, the forecasts from finished runs (Usually, Agent, Queue, Waiting on you, Cost and Runs per size, with Default and what the runs measured so far for a size under 5 runs), and the plan budget: the most files and steps a plan may have before its planner proposes a split. In a Flow project the section is called Plan budget and holds the plan budget only. A Flow project's issue pages show no Start and Target, no timeline and no Schedule button. Settings, Projects lists the Project's fields under Plan on GitHub and offers Add the fields when one is missing: Start, Target, Size or Estimate in a Timeline project, and Size only in a Flow project. On the Plan page, a Project without Size or Estimate shows the banner "This Project has no Size and no Estimate field" with Add the fields, which asks before it writes.

### Moving bars

Drag a task's bar to move its Start a day at a time, and its Target follows. Drag the right end of a sized bar to set a manual estimate in whole hours; its size stays. The end has a handle on bars at least 12 px wide. A tooltip names the day, the duration and the Target that follows, and a dashed ghost marks where the bar was. Escape puts the bar back. Each drop saves Start, Target and the estimate it set to GitHub at once, with a toast and Undo. If GitHub refuses the write, the bar goes back and the toast offers Try again.

A drop before a blocker ends is allowed. The bar's left edge and the arrow from the blocker turn red, the row's warning adds "Starts before #143 ends", and the blocker stays where it is. A task with dates and no duration moves both dates by the same number of days. Done and Running tasks, and tasks a run works on, do not move.

With a bar focused, the arrow keys move it a day, Shift with an arrow changes its estimate by an hour, and E opens the size popover. The save follows 800 ms after the last key, or when the bar loses focus. An unscheduled task with a size or an estimate has a grip in Unscheduled that drags it onto the chart. Under 640 px nothing drags: a sized task has a Start button, and its Target follows from its duration.

A sized task's run strips start under the bar's left edge at the bar's scale, so a run that takes longer than the duration shows its overrun in red. While an active run is past the duration, the row says "Over forecast by 50m" instead of Overdue. The bar's hover card gives the size, the forecast with its parts and cost, the estimate, the actual time so far and the clock times of each run.

### Arrange by estimate

Arrange by estimate, in the Unscheduled header, lays out the unscheduled tasks in view that have a size or an estimate. It places them from today in blocked-by order, fills each day up to the capacity after the work already planned (including bars the filters hide), and starts no task before its blockers end. Tasks with dates stay where they are. It shows a preview first: a banner with the placed tasks' range, dashed bars, the preview's hours in the load row, and Needs a size on the tasks it left out. Cancel writes nothing. Save writes Start and Target for every placed task. A task GitHub refuses goes back to Unscheduled, and the toast names it with the reason. When no unscheduled task in view has a size or an estimate, the button is off and says why.

### The Flow

In a Flow project the Plan page's third view is the Flow. The tree of epics, stories and tasks stays on the left, as on the timeline. On the right, each task's card sits on its row along an order axis with a Now line, in the lane the scheduler would start it in. The Flow shows no dates, hours or minutes. A card's length is its size's forecast and only decides which lane frees first; a task without a size counts as M and its size chip is dashed. The legend says the same: "Length follows the size: S, M or L. Flow has no dates."

The Flow has one lane per run the scheduler may hold at once: `max_runs`, or 1 when the scheduler has never been turned on. The lanes show as Slot 1, Slot 2 and so on, in a strip at the top that repeats every card. The header gives the runs and the worker's Claude slots, for example "3 runs at once, 1 Claude slot", and the scheduler's order.

The Flow places cards by following the scheduler's rules from now:

- Each active run takes a lane, oldest first. Its card straddles the Now line, filled by the share of its graph's steps that are done, such as "3 of 7 steps". When a review loop sends the run back to the coder, the coder and the steps after it stop counting as done until they pass again, so the count can go down. A run that waits on you has a dashed ring, and its row says what it waits for. It keeps its lane, because it counts toward `max_runs`.
- The queue is the Ready tasks the scheduler may start, in its order, and then the Shaping tasks in Project order. A Ready card is blue, and its row has its Next tag, its place in the queue. The tree shows the same Next tags in every view of a Flow project. Shaping cards are faded and tagged Shaping, since the scheduler starts none of them until you move them to Ready.
- When a lane frees, the first task in the queue whose blockers have ended starts in it. A blocked task is passed over for the next one, as the scheduler does. When no task may start, the lane waits for the next card to end, and the task that starts then says "After #55". Arrows run from a blocker's end to its task's start.
- Tasks with the skip label or a cancelled latest run keep their rows with "Skipped: label human" or "Skipped: latest run cancelled" and "Not in the order". A task blocked by an issue outside the order says "Waits for #N, not in the order" and has no card. Done tasks say Done.
- While a failed run or a permission request holds the project, the header shows "Held" with the reasons, and the first task in the queue says "Waits for the hold". While the scheduler is off or paused, the header says tasks start when someone starts them, in this order.

Hover over a card to see the task's size, place, lane and blockers. Under 640 px the Flow is a list in order, with each task's slot, Next tag, steps and row tags, and nothing drags.

### Moving cards

Drag a Ready card along its row to give it a new place in the queue. While it moves, a dashed outline marks where it was and a tooltip says where it lands, for example "Next 1, before #58. Lands in slot 3. 3 cards move." Escape puts it back. With a Ready card focused, Alt and an arrow move it a place: Left and Up earlier, Right and Down later. The save follows 800 ms after the last key. Running, done, skipped and Shaping cards do not drag.

A drop saves the new order to Project order on GitHub at once and pins the card. The toast says, for example, "#74 moves to Next 1" and "Saved to GitHub in Project order. #74 is pinned.", with Undo, which writes the old order back and removes the pin the drop added. If GitHub refuses the write, the card goes back and the toast offers Try again. If the order on GitHub changed since the page loaded, the write is refused with "The order changed on GitHub since the page loaded. The Flow now shows the new order."

A drop before an open blocker that is in the queue opens a dialog, such as "#62 can't start before #61", with three choices:

- Move to the next free slot, the default, puts the task right after its last blocker in the queue.
- Move #61 earlier too keeps the task where you dropped it and moves its blockers, with their own blockers, to just before it.
- Keep it here leaves the task where you dropped it with the warning "Waits for #61", a red edge and a red arrow. The Flow still starts it after #61 ends.

"Move the tasks that wait on #62 with it" is on by default. It moves every task that #62 blocks, directly or through others, and that would now sit before it, to right after it. Turn it off to move only #62; a task that then sits before its blocker gets its own "Waits for" warning. Each choice says which places it gives, saves at once, pins the card, and offers Undo.

Dragging works in Project order. Under Priority order a drop opens "The scheduler starts tasks by Priority" with Switch to Project order and Cancel. Switching saves the scheduler's order and then saves the drop; the scheduler keeps its other settings.

### Pins

A pin keeps a task at its place number while other tasks move. A dropped card is pinned and shows a pin. Click the pin on the card, or the Pinned tag in its row, to unpin it. Every later drop, dialog choice and Optimize puts each pinned task back at its place number, and its number falls as tasks ahead of it start. A pin ends when its task's run starts. GitHub Projects has no field for a pin, so handoff stores pins in its database. Agents pin only through `set_order`'s `pin` list, when you ask for a task's place to stay.

### Optimize

Optimize, in the toolbar of the Flow, arranges the queue for the earliest finish on the lanes. Each place, from the front, takes the highest-ranked task whose blockers in the queue come earlier. A task ranks higher when it starts a longer chain of work, then when it unblocks more work, then by Priority when the Project has a Priority field, then by the larger size. Pinned tasks keep their places.

It works on the whole plan, or on what you tick in the tree: each row of the Flow has a tick box, and ticking an epic or a story ticks the tasks under it. The toolbar then says, for example, "1 selected", with a button that clears the selection. Tasks outside the selection keep their places.

Optimize shows a preview first and writes nothing until Apply. The banner says what it will do, for example "Optimize will move 3 tasks in epic #12 Project management. 1 pinned stays." The moved cards are dashed at their new places, their old places are outlined, and their Next tags add the place they had, such as "was 3". Cards do not drag during the preview. Apply writes the order to GitHub with the toast "Optimized epic #12 Project management" and "Moved 3 tasks. 1 pinned stayed.", with Undo, which writes the previous order back. Cancel, or Optimize again, closes the preview. Under Priority order Optimize asks to switch the scheduler to Project order first. Under 640 px the toolbar has no Optimize.

`arrange_plan` gives agents the same preview, and `set_order` writes it with an approval card (see Shaping). Neither Optimize nor `arrange_plan` pins or unpins.

### Milestones

A milestone of the project's repository gives a release or a phase a title and a due date, and it can cut across epics. You create, edit and close milestones on GitHub; handoff has no tool for that. handoff reads the repository's milestones, open and closed, with every read of the plan, and it reads each plan issue's milestone with the items. It sets an issue's milestone on GitHub and stores nothing about milestones.

A task belongs to its own milestone, else its story's, else its epic's, and a story without one belongs to its epic's. An epic has only its own. An inherited milestone shows dashed with where it comes from, such as "from epic #12". A milestone's progress counts tasks only, its own and inherited ones, and a closed task counts as done. Epics, stories and pull requests are not counted, so the number can differ from the percentage on GitHub's milestone page, which counts the issues and pull requests set in the milestone directly.

Every view of the Plan page has a row of cards between the scheduler card and the toolbar: one for each open milestone, then one for the open tasks in no milestone when there are any. A card has the due date, the tasks by status in a bar, the tasks done of total, and one line that follows the plan mode:

- In Timeline mode the line compares the latest Target of the milestone's tasks with the due date: "Ends Oct 4, 1 day late" in red, or "Ends Oct 13, 3 days early" in green. The card names the open tasks without dates, such as "#152 has no dates", and does not count them.
- In Flow mode the line says where the milestone's last task sits in the order, such as "Ends after Next 6", and how many of its tasks the scheduler skips. Flow gives no day and no late or early.

Closed milestones have no card, and the row hides when the repository has no open milestone. Under 640 px the cards scroll sideways.

A click on a card filters the plan to that milestone, and a second click clears the filter. The toolbar's Milestone filter, after Assignee, offers All milestones, each open milestone with its due date and tasks done, No milestone, and the closed milestones under Closed. The filter is part of the URL, as `?milestone=<number>` for a milestone, open or closed, and `?milestone=none`. It keeps the tasks whose own or inherited milestone matches, with their stories and epics, and hides the unplanned issues. A chip clears it. A repository without milestones has no Milestone filter.

Rows in the tree, the timeline and the Flow show the milestone an item has of its own; an inherited one shows on the row of the story or epic it comes from. Board cards and the Flow's list show every task's milestone, dashed with "from epic #12" when it is inherited, unless the filter already names it.

With a milestone in the filter, the timeline draws its due date as a dashed line at the end of the due day, with a flag such as "Redesign beta, due Oct 3". When the plan ends the milestone late, the line and the flag turn red, the days past the due date are hatched, the chart says "Ends Oct 4, 1 day late", and each task that ends after the due date has "Ends after Oct 3" under its title. The chart's range reaches the due date. Under 640 px the list marks the same tasks.

With a milestone in the filter, the Flow draws a dashed line after the milestone's card that ends last, with a flag such as "0.9 ends here, after Next 6", and that task's row says Last of 0.9. The due date shows only in the flag's tooltip. The Flow shows no forecast and no late or early for a milestone. The line follows a drag, Optimize's preview and a saved move, and the slot strips fade the cards outside the milestone. Under 640 px the Flow's list has a row after the milestone's last task with the same words and the due date. The scheduler and Optimize do not order by milestone.

Home has a Milestones section above Features in progress. It lists the repository's open milestones by due date, then those without one. Each has its title, which links to the Plan page with `?milestone=<number>`, "Due Oct 20, in 18 days" or "No due date", its tasks by status in the bar Features in progress uses, and the plan mode's line. In Flow mode it names each skipped task with the reason, such as "#63 skipped: label human". In Timeline mode it names the open tasks without dates. The section hides when the repository has no open milestone.

On the issue page, every epic, story and task of the plan has a Milestone section in the rail: under In the plan on a task, and under Progress on a story or an epic. Its button shows the issue's own milestone, the one it inherits, such as "0.9 from epic #12", or a dashed No milestone. The line under it gives the due date, the tasks done of total and the plan mode's line. The picker lists the open milestones with their due dates, and the closed ones under Closed, which you cannot pick. Clear shows while the issue has a milestone of its own. A pick sets the milestone on that issue only and saves to GitHub at once, with a toast and Undo, which writes back the milestone the issue had of its own. On an epic or a story, the items under it without a milestone of their own inherit it. A refusal shows its reason under the button and changes nothing. An issue outside the plan shows its milestone without a picker and says "Plan #n to change its milestone here".

The assistant and the Claude Code plugin read milestones with `list_plan` and set them with `set_milestone` and the `milestone` option of `create_epic`, `create_story` and `create_task`, each with an approval card (see Shaping). In Timeline mode `list_plan` gives each milestone the day it `ends`, `against_due` ("2 days late", "3 days early" or "on the due date") and its `undated_tasks`. In Flow mode it gives `last_in_order` and `skipped`, and no day.

Runs leave milestones alone. The PR node sets no milestone on the pull request, and the merge step changes no issue's milestone.

### Staying up to date

GitHub sends no webhook when a card moves on a Project owned by a user account. For an organization's Project GitHub sends `projects_v2_item` webhooks, but only to an organization webhook or a GitHub App; handoff's repository webhooks and `pnpm dev:webhooks` do not receive them, and handoff does not use them. So for both owners the Plan page reads the Project each time it renders and refreshes itself every 30 seconds while the browser tab is visible. A change made on GitHub's board shows on the dashboard within 30 seconds.

`pnpm dev:webhooks` also relays the repository's `issues`, `sub_issues` and `issue_dependencies` events. handoff stores them with every other delivery. They wake nothing; the Plan page uses the latest one for its "last GitHub activity" line.

### Moving a repository to an organization

When GitHub moves a project's repository to another owner, for example from your account to an organization, handoff still uses the old owner and name. The plan's Project belongs to the old owner, so the plan looks empty, status writes from runs record `plan.skipped`, and the scheduler finds no Ready task. When the project stores the repository's id, `add_project` with the new name refuses and names the project and the move.

Move the project with the CLI:

```bash
pnpm handoff project move <project> --repo <owner>/<name>
```

or in the dashboard: Settings, Projects, Repository moved, next to Edit and Delete. The dialog takes the new owner and name and says what changes before you save, for example "handoff will use Task-Insight/web for this project's runs. The plan's GitHub Project belongs to Krister-Johansson, so it is unlinked; set up the plan again. The scheduler pauses."

The move refuses while the project has an active run, when GitHub gives the new name another id than the one the project stores, and when another project already uses that repository. Without GitHub configured it does not check the id. It updates the owner and name and rewrites the repository part of each run's issue links. Runs, graphs, pins and the scheduler's settings stay. When the owner changed, the move unlinks the plan's Project and pauses a scheduler that is on, with the reason "The repository moved to <owner>. Set up the plan again, then resume." A rename within the same owner keeps the plan and the scheduler. The CLI prints the old Project's owner and number as the `copy_from` to give `setup_plan`.

Then set up the plan again with `setup_plan`, with `use` for a Project the organization already has, or without it for a new one. With `copy_from: { owner, number }`, the old Project's owner and number, it then copies the repository's items of that Project into the plan's Project with their Status and the fields the plan mode uses (Size in a Flow project; Size, Estimate, Start and Target in a Timeline project), in the old Project order. The result lists them under `copied`. Priority is not copied, and `copied.items_with_priority` lists the items that had one. The old Project stays on GitHub as it is, for you to close. `copy_from` refuses the plan's own Project.

You still install the GitHub App on the organization when handoff uses one, run `pnpm dev:webhooks <owner>/<name>` with the new name, and authorize the token for the organization's SSO if it has one (see The token). The worker clones the new remote into a new folder under `HANDOFF_HOME/repos`, and the old clone stays there until you remove it.

## The scheduler

A project with a plan has a scheduler. It is off until you turn it on. Once on, the worker starts runs by itself on the plan's Ready tasks, so a planned project moves forward without a `start_run` for each task. Deciding what is Ready stays with you: the scheduler never moves a task to Ready, never requests a merge, and never answers, repairs or cancels a run.

### What it starts, and in what order

The worker checks each project whose scheduler is on every 60 seconds. These bring the check forward: a run ends, a run the scheduler started gets its plan, a merge closes issues, someone answers a question or decides a permission request, a run is repaired or cancelled, a stuck loop is resolved, `move_to_ready` moves tasks, someone lets the scheduler take a cancelled task, and someone turns the scheduler on, resumes it or changes its settings. A check never comes sooner than 10 seconds after the last one. handoff gets no webhook when you move a card on the board, so the scheduler sees a task you move to Ready there on the next 60 second check.

A task is a candidate when it is an open task in Ready, has no open blocker, has no active run, does not carry the skip label, and is not a task whose run you cancelled (see A cancelled task). Epics, stories, tasks in other columns and issues outside the Project never start by themselves.

Candidates start in Project order: the order of the items in the GitHub Project. With the order set to priority, Priority comes first. It is the Project's own single select field named Priority, whose first option ranks highest. When the Project has no such field and the repository's owner is an organization with a single select Priority issue field, each issue's value in that issue field counts, and its options rank by their priority number. Items without a value come after every item with one, and Project order breaks ties. The scheduler card, Project settings and `get_scheduler` say which field orders the tasks. The scheduler refuses priority order without either: in an organization the sentence names both, for example "GitHub Project #3 has no Priority field and Task-Insight has no Priority issue field, so the scheduler cannot order tasks by priority. Add a single select field named Priority, or use Project order."

Each check starts at most one run, on the first candidate, with the scheduler's graph (the project's default graph unless you pick another) and the task linked as the run's issue. The start goes through the same checks as `start_run`, so a task that is blocked or taken by then is skipped for that check and the next candidate is tried. The next start waits until the run it started has a plan from its planner, so the runs it starts are planned one at a time. With a graph that has no Planner node, the next start waits until that run ends.

### Max runs and the Claude cap

`max_runs` is the most runs of the project that may be active at once, 1 to 10, and 1 when you first turn the scheduler on. It counts every queued, running or waiting run of the project: runs you started, runs waiting at a review and runs waiting in the merge queue. With `max_runs` runs active, a check starts nothing and reads nothing from GitHub.

The Claude cap is separate. `HANDOFF_CAP_CLI` limits Claude processes across all projects, and the scheduler never changes it. With `max_runs` above the cap, runs take turns at their Claude steps while their other steps (CI, reviews, the merge queue) go on. The dashboard and `get_scheduler` show both numbers, for example "2 of 3 runs active, 1 Claude slot".

### What holds new starts

Two things hold the project, and while either does, the scheduler starts nothing and reads nothing from GitHub:

- a failed run, including a loop that ran out of rounds
- a pending permission request

Holds count every run of the project, whoever started it and however old it is. Once you repair or cancel the failed run, resolve the loop or decide the permission request, the scheduler checks again within about 10 seconds and goes on by itself.

A run waiting on you for anything else does not hold the project: an open question, a plan or code review, Try it, a pull request waiting for a review, or a pull request waiting in a manual merge queue for you to merge it. That run stays active and counts toward `max_runs`. With `max_runs` at 1 nothing new starts while it waits; with a higher limit the other slots keep working.

### Overlap waits

Before the coder's first attempt in a run the scheduler started, the worker compares the paths the run's plan owns with the paths every other active run of the project owns. A directory owns the files under it, a file owns itself, and `package.json` counts as one unit with its lockfiles. If they overlap, the coder waits and the run records `run.overlap_held`, naming the other run and the shared paths. The waiting run holds no Claude slot but counts toward `max_runs`. It checks again when a run of the project ends or is cancelled, when a merge lands, and after 10 minutes at the latest. A run waits only for runs started before it and for runs a person started. Runs you start yourself never wait on overlap.

### Pausing and turning off

Pause (`pause_scheduler`, or Pause on the dashboard with an optional reason) stops new starts until you resume it with `start_scheduler` or Resume. Active runs go on. Saving the settings in Project settings keeps a pause.

The scheduler pauses itself when three checks in a row fail for a reason that is not one task's refusal, such as a graph that no longer exists or GitHub refusing the read. It records the last error and sends a notification. Fix the cause, then resume it.

Turning it off (`stop_scheduler`, or Turn off in Project settings) stops new starts, forgets a pause and the last check, and keeps the settings. Active runs go on. Turning it on again starts it as the first time did.

### A cancelled task

Cancelling a run moves its task back to Ready, but the scheduler does not start it again. It skips the task with "cancelled run; start it by hand". Start it yourself (Start run beside the skipped task, or `start_run`), or press **Let the scheduler take it** beside it. That releases the task for the cancelled run; if you cancel its next run too, it needs a new release.

### The skip label

The scheduler skips tasks with the skip label and leaves them to a person. The label is `human` when you first turn the scheduler on. Change it with `skip_label` or **Skips tasks labelled** in Project settings; an empty label skips nothing.

### Where to see it

On the dashboard:

- The Plan page has the scheduler card. It shows the state (Off, Running, Held, Idle or Paused) with Turn on, Pause or Resume, the active runs, the next three tasks, the skipped Ready tasks with their reasons, what holds the project with a link to each run, and the recent events. The tree marks the next three tasks Next 1 to Next 3; in a Flow project it marks every Ready task with its place in the Flow's queue.
- Home shows one line with the state and the same action while the scheduler is on.
- Project settings has a Scheduler section: turn it on or off, pause or resume, set the runs at a time, the order, the graph and the skip label, and read the worker's Claude cap.
- Settings, Projects shows the state and the active runs on the project's row, for example "Scheduler held, 1 of 2".
- The Runs table and the run page tag the runs it started with Scheduler. The run's events list `run.scheduled` right after `run.created`, with the task's place in the order and the scheduler's settings at that moment.

Over MCP, for the assistant, Claude Code with the handoff plugin and WebMCP:

- `get_scheduler` shows the state, what holds it with links, the active runs against `max_runs`, the Claude slots, runs waiting on overlap, the next tasks, the skipped ones with their reasons, and the recent events.
- `start_scheduler` turns it on, resumes it, or changes `max_runs`, `order`, `graph` and `skip_label`. It asks for approval first, with a sentence such as "Let handoff start up to 2 runs at a time on Ready tasks in todooverkill, in Project order, with graph master".
- `pause_scheduler` and `stop_scheduler` pause it and turn it off.
- `list_runs` and `get_run` report who started each run in `started_by`.

`start_scheduler` refuses a demo project, a project without a plan (run `setup_plan` first), a graph the project does not have, priority order without a Priority field (or, in an organization, a Priority issue field), and a dashboard without access to GitHub Projects. The worker needs that access too: the Plan's token (see The token). A worker without it logs that the scheduler is off and checks nothing.

### Setting up a project for the scheduler

The scheduler's runs start without you watching, and several can be active on the same machine at once. Before you turn it on, edit the project in **Settings, Projects** and fill in three fields.

- **Setup command.** It runs once in each run's worktree, before the first step that uses it, and again only if you change it. Install the dependencies there, for example `pnpm install --frozen-lockfile` or `npm ci`. It sees `HANDOFF_RUN_ID`, `HANDOFF_RUN_SHORT` (the first eight characters of the run id) and `HANDOFF_WORKTREE`. If the tests need a database, give each run its own, named after `HANDOFF_RUN_SHORT`, for example by copying `.env.example` to `.env` with the test database's name changed to `app_test_$HANDOFF_RUN_SHORT`. A setup command that fails fails the step that needed it, with the command's output.
- **Teardown command.** It runs in the worktree just before handoff removes it, with the same three variables, and drops what the setup command made, for example `dropdb --if-exists app_test_$HANDOFF_RUN_SHORT`. handoff removes a worktree when its run succeeds or is cancelled. A failed run keeps its worktree until you repair or cancel it, or `pnpm handoff gc` removes it.
- **Agent notes.** Every agent step reads them as facts about the project's environment, for example "The database container is shared and already running." handoff stores them as plain text, so keep secrets out.

The Tester and every Claude step also see the three variables, and the agents are told to name anything they create outside the worktree after `HANDOFF_RUN_SHORT`. `setup_project` warns when the repository has a lockfile and no setup command.

## Search

Cmd+K or Ctrl+K opens search from any page, in a text field too. On a Mac, Ctrl+K in a text field stays "delete to end of line". The top bar's Search button shows the shortcut (⌘K on a Mac, Ctrl K elsewhere); on a phone it is an icon, and search fills the screen with Cancel.

One query finds tasks, runs, pages and chats. Search covers the open page's project, or outside a project the one used last; the chip in the input picks another project or All projects. Runs, chats and names of other projects show under Other projects. Their tasks come only with All projects, since those need GitHub. Before you type, search shows Recent (the last 4 results opened, kept in this browser), the project's active runs and a few pages to go to.

- Results come in groups of 3 with Show more. Tab and Shift+Tab move between the filters All, Tasks, Runs, Pages and Chats.
- `#` filters to tasks and matches numbers, so `#4` finds #41 to #48. `/` filters to pages and settings sections.
- Esc clears the query, then closes. Enter opens the result; Cmd+Enter or Ctrl+Enter opens it in a new tab. A chat opens in the assistant panel.

Opening search reads the runs (the latest 200 of each project), chats and projects from Postgres, and the tasks from the plan on GitHub Projects through a cache that lives 60 seconds, so typing never reads GitHub. A project without a plan searches its open issues. When GitHub does not answer, the tasks come from the issues the runs linked, without their status, with Try GitHub again. A Flow project's results show no dates.

## The assistant

The assist button in the bottom right corner (or Cmd or Ctrl+J) opens the assistant. From 1280 px the panel docks beside the page; below that it floats above the button, and on a phone it fills the width under the top bar. Ask what needs you or how a run is going, or tell it to start, answer, merge, repair or cancel something. It can also open pages for you: the inbox for a project, a run, a review or Try it. The panel stays open while the page behind it changes. The message box has its own microphone for dictation.

The sidebar's **Chats** group lists your conversations from every project: Pinned first, then the six most recent, each with its project's letter and how long ago it was used, or Approve while an approval waits and Answering while a reply streams. The menu on a row pins, renames (F2) and deletes a conversation. **View all** opens the Chats page, with search over titles and messages and a project filter.

- **How it runs.** Each message runs the Claude Code CLI from the dashboard on your subscription, with the same `CLAUDE_CODE_OAUTH_TOKEN`. The CLI gets handoff's tools and nothing else: no shell, no files, no web. Without the token the assistant is off and the panel says so.
- **Approvals.** Reading happens without asking. Anything that changes something (starting, answering, merging, repairing, cancelling, adding a project) shows an approval card with what it will do and the arguments. Nothing happens until you press Approve. Deny takes a note that tells the assistant why. A card nobody answers within 5 minutes counts as denied.
- **Settings.** **Settings, Assistant** switches the assistant off, picks the model (Sonnet by default, or Opus or Haiku) and shows the model that ran last. `.env` sets the defaults: `HANDOFF_ASSISTANT_MODEL`, `HANDOFF_ASSISTANT_EFFORT`, `HANDOFF_ASSISTANT_MAX_TURNS` and `HANDOFF_ASSISTANT_APPROVAL_TIMEOUT_MS`.
- **History.** Conversations are stored in Postgres. A conversation belongs to the project of the first page it was asked on that names one, or to none. The browser remembers the open conversation, so a reload opens it again, and a conversation that is still answering keeps streaming into the panel. `pnpm handoff gc` removes those not used for 30 days, with their transcripts (`--assistant-days` changes that). Pinned conversations stay.
- **Browser agents (WebMCP).** In a browser with WebMCP (in Chrome, `chrome://flags/#enable-webmcp-testing`), every dashboard page offers the same tools to an agent in the browser, with the same approval card for changes. A page with tools of its own (see below) offers those too while it is open. The start run form, the inbox's answer forms and the permission cards are declarative WebMCP forms: an agent can fill them, and you press the button. **Settings, Assistant** turns WebMCP off for this browser, page tools included.

The assistant shares your subscription's limits with the worker's Claude nodes, and `HANDOFF_CAP_CLI` does not count it.

### Page tools

Some pages give the assistant tools of their own while they are open, so "show the graph" on a run page shows that run's graph. Their names start with `page_`. Each message carries the page you asked it on, and the assistant gets that page's tools for that message. `where_am_i` returns the page's state: the steps, criteria or cards on screen, with the ids, keys and numbers the tools take. That state holds text from issues and runs, and the assistant treats it as data, not as instructions.

These pages have tools:

- The run page shows its Steps, Graph or Events view, opens a step (its latest attempt or a given one), closes it, pops it out into a large window, and narrows the events to one node or adds the Claude CLI's own events.
- Try it marks a criterion as working, not working or unchecked, with a note, moves between criteria, expands or collapses them, writes the overall note, submits (approve, or send the app back to the coder) and restarts the app. Once Try it is answered, only moving between criteria and expanding them remain.
- The code review moves between files by path, number or next and previous, shows the changes or the whole file in one column or side by side, expands or collapses files, marks a file viewed, drafts a comment on a line or a range of lines the diff shows (with the code quoted), removes a drafted comment, writes the overall comment and submits the review. `where_am_i` also lists the code reviewer's findings by severity; you open a follow-up issue from them with the Create follow-up issue button, which has no page tool. Once the review is answered, only moving between files and changing the view remain.
- The plan review drafts a comment on a passage of the plan, quoted as the page shows it, removes one, writes the overall comment and submits the review.
- The graph editor selects a node or an edge, reads a node's or an edge's settings, changes them with the inspector's fields, renames a node, adds a node, connects two nodes, removes nodes and edges, tidies the layout, lists the graph's issues and saves the graph as its next version. While the editor is locked, adding, connecting and removing are refused, as on the canvas.
- The Inbox shows a card: it scrolls the card into view and focuses it. The assistant answers questions, decides permission requests, repairs, cancels and merges with its own tools, using the ids `where_am_i` lists for the cards.

A change to what a page shows, or to a draft it holds such as a criterion's mark, runs without asking: you see it on the page, and nothing is sent. Marking a file viewed also runs without asking, and saves the mark as ticking its Viewed box does. Submitting Try it, restarting the app, submitting a review and saving the graph show an approval card first, as the assistant's other changes do. If you leave a page while the assistant works on it, a call to the old page's tools answers that the page changed, and the new page's tools come with your next message.

## Voice in Chrome

In Chrome you can speak to the dashboard and have it speak back. Every button and key works the same without voice.

Listening is push to talk. Press V outside a text field, or the microphone button in the header, and the dashboard listens. Escape stops listening and drops what was half heard. Chrome recognizes speech on your computer by default, so the audio and the transcript stay on it. The first time, the microphone button may show a download icon instead: press it to install your language for offline use. If your language has no on-device pack, turn on **Settings, Voice, Server-based recognition**. Chrome then sends your voice to Google's speech service. That switch is off until you turn it on. In a browser without speech recognition the microphone button is not shown.

A question asked with V opens the voice bubble at the bottom of the page. The bubble shows what Chrome hears and sends the question to the assistant, in the conversation the panel has open. While the assistant works, the bubble shows "Thinking" or the tool it calls. Then it shows the reply and speaks it, up to three sentences. When the assistant asks for approval, the bubble reads the action out and listens once. "Yes" (or "approve", "go ahead") approves. "No" (or "deny", "stop") denies, and the words after it become the note. The Approve and Deny buttons work too. Escape stops the speech, and a second Escape closes the bubble. **Open in panel** shows the whole conversation. With the assistant off, the bubble says so and sends nothing.

To dictate, click into a text field, such as the assistant's message box or a review note, and press the microphone button. The dashboard listens until you stop it and puts each finished phrase in the field at the caret. Words Chrome is still working out show in the strip under the header, not in the field. Dictation never sends anything: you press Send or Submit as usual. Where Chrome supports it, it adds punctuation from your pauses. With on-device recognition, Chrome also favours the project names and node keys shown on the page.

The dashboard speaks with ElevenLabs. Add `ELEVENLABS_API_KEY` to `.env` and restart the dashboard; without a key nothing is read aloud. The key stays on the server: the browser sends each sentence to the dashboard, and the dashboard gets the audio from ElevenLabs. The text that is read aloud goes to ElevenLabs. `HANDOFF_ELEVENLABS_VOICE_ID` sets the default voice (otherwise the account's first voice) and `HANDOFF_ELEVENLABS_MODEL` the model (`eleven_flash_v2_5` by default). The dashboard never listens while it speaks: V or the microphone button stops the speech first.

**Settings, Voice** keeps these settings in your browser:

- the language you speak, and server-based recognition
- Speak replies, for the assistant's replies in the panel (replies in the voice bubble are always spoken)
- Speak notifications, for new questions, permission requests, failed runs and pull requests ready to merge, and Also finished and merged runs
- the ElevenLabs voice, the rate and a Test voice button
- the voice shortcuts

## Running each run in a container

```bash
pnpm docker:runner
```

Then set `HANDOFF_WORKSPACE=docker` in `.env`. Each run gets its own container from the runner image (Node 24, git, pnpm, the pinned Claude CLI, and the Playwright MCP server with Chromium for the Demo step), with the worktree mounted at the same path. Claude, the Tester and command checks run inside it, and the container is removed when the run ends. `HANDOFF_DOCKER_NETWORK` puts the containers on a network you control, for example one with restricted egress.

### The app in a container

A Demo or Try it step starts the run's app in a container of its own, `handoff-preview-<id>`, next to the run's container. It has the run container's image, mounts, user, environment and network, so the app runs on Linux against the `node_modules` the setup command installed in the run's container. The seed command runs in the app's container too.

The app gets a free port in `PORT`, the same number inside the container and on your machine, and opens at `http://localhost:<port>`. handoff publishes the port on `127.0.0.1` and `[::1]` only, or on `127.0.0.1` alone when Docker refuses `[::1]`, so other machines cannot reach the app. The Try it page says which container runs the app. A published port reaches the container's own address, not its loopback, so the app must listen on `0.0.0.0`. handoff sets `HOST=0.0.0.0` unless the configuration sets `HOST`, but not every dev server reads it. The app counts as up once it answers a request through the published port. When it listens on `127.0.0.1` inside its container, the step fails and says to make it listen on `0.0.0.0`.

The compose services start on your machine as in worktree mode. The app's container runs a small forwarder as its main process: for each port the compose file publishes, it listens on that port at `localhost` inside the container and forwards each connection to `host.docker.internal` on the same port. A `localhost` URL such as `postgres://app:app@localhost:5432/app` works unchanged, in the launch configuration and in the repository's own `.env` files. Before the seed command, handoff connects to each forwarded port from inside the container, and the services step fails and names any port it cannot reach.

On Linux, `host.docker.internal` resolves to the host's address on the Docker bridge, which does not reach a service bound to `127.0.0.1` on your machine. Publish the service's port on all addresses, as `"5432:5432"` rather than `"127.0.0.1:5432:5432"`, or use worktree mode. Docker Desktop on macOS reaches services bound to `127.0.0.1` as well.

Use Docker Engine 28 or later. Docker documents that older releases may let hosts on the same L2 segment reach ports published on localhost. With an older Engine, App launch and the readiness check show a warning, and the app still starts.

The Demo step's Claude runs in the app's container, so the headless browser it drives opens the app at the same `http://localhost:<port>`. The browser is Chromium from the runner image and needs no download at run time. The Playwright MCP server still starts through `npx`, which asks the npm registry for the version even though the image has the package installed, so a Demo needs npm registry access on `HANDOFF_DOCKER_NETWORK`.

Test start in Project settings, App launch, makes two containers, as a run does: the setup command runs in `handoff-<id>` and the app in `handoff-preview-<id>` next to it. Test start runs in the dashboard's process, which reads the same Docker settings from `.env` as the worker. Stop, the 10 minute limit and the next Test start each remove both containers and the worktree. A dashboard that restarted stops a Test start past its 10 minutes the next time it reads it.

Stopping an app sends SIGTERM to every process in its container, waits up to 5 seconds, then removes the container. That happens when its step ends and when the run is cancelled. When a worker starts, it stops the apps that earlier worker processes on this host left running, whatever their worker id, and removes their containers. Then it removes every container labelled `handoff.preview` whose app is no longer starting or running. A worker that crashed less than 60 seconds before the new one starts still counts as live, so its apps survive that start. A worker stopped with SIGINT or SIGTERM is no longer live at once.

## Costs and limits

Claude usage counts against your subscription's limits, shared with your own Claude use. The cost figures on the run page are estimates reported by the CLI, not a bill. By default only one Claude node runs at a time (`HANDOFF_CAP_CLI=1`); raise it if your plan allows.

handoff is meant for your own use with your own Claude login. Anthropic does not allow third-party products to route other people's requests through their Claude subscriptions, so sharing a handoff instance with other users would need API keys instead.

## Development

The project is built test-first. `CLAUDE.md` has the working rules and commands, `docs/plan.md` the design, `docs/adr/` the decisions, and `GLOSSARY.md` the vocabulary.

```bash
pnpm test         # unit, integration and web tests
pnpm typecheck
pnpm lint
```

The integration tests need Docker running. They do not use the database from `pnpm db:up`: each run starts its own Postgres container with Testcontainers, migrates it and removes it afterwards, so several checkouts can run them at once. Set `TEST_DATABASE_URL` to run them against a database of your own instead.

The Claude CLI version is pinned in `HANDOFF_CLAUDE_VERSION`. The worker refuses to start with a different version, because the CLI docs say `--bare` will become the default for `-p`, and bare mode ignores subscription logins. Check the changelog before bumping it.
