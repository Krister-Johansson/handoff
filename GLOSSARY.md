# Glossary

Terms used in handoff. Test names, types and issue titles use these words.

- **Project**: a connected GitHub repository plus its graphs and runs.
- **Graph**: the program. A versioned set of nodes and edges stored in graphology's export format. Edited in React Flow.
- **Node**: one unit of work with a single responsibility. Has a type from the catalog, a context selector, a contract and an executor.
- **Edge**: routing between nodes. Carries a condition evaluated against run state. A loop edge points back to an earlier node and has a max-attempts guard.
- **Run**: one execution of a graph against a task. Owns the run state document.
- **Run state**: the JSON document that accumulates as a run moves along edges: task, plan, diff summary, test results, PR number, feedback, attempt counters.
- **Node execution**: one attempt of one node inside a run. Status is pending, running, waiting, passed, failed or repaired.
- **Context packet**: the subset of run state and repo files a node execution may read. What the node is allowed to believe.
- **Contract**: the schema a node execution's output must satisfy plus the deterministic checks the engine runs before following any edge. What the node must deliver.
- **Deterministic check**: a true or false test run by the engine, never by a model: tests pass, diff within owned paths, PR exists.
- **Waiting**: a node execution that has yielded and will be resumed by an external event, such as a GitHub webhook or a human answer.
- **Human gate**: a node that waits for a person to answer a question or approve a step in the dashboard.
- **Question**: what a human gate, or a paths question, asks a person, stored with its options and what the gate shows for review. It is open until someone answers it, and the inbox lists the open ones.
- **Notification**: something a person is told: a tone, a title, a body and an optional link, written by whoever sends it and shown as it is. Read or unread, never done. A question has a notification, and the two are separate rows.
- **Coder node**: a node whose executor spawns the Claude Code CLI in a worktree.
- **PR node**: a node that opens or updates a pull request, then waits for checks and reviews and routes the feedback.
- **Paths question**: what a node execution asks when the diff-within-owned-paths check is its only failing check. It waits, names the files outside the plan, and a person answers Allow for this run, Send back or Fail the step.
- **Worktree**: a git worktree created per run where a Coder node works. A failed run keeps it until the run is repaired or cancelled, or `handoff gc` removes it.
- **Library**: the catalog of skills and MCP servers that can be enabled per node or per edge.
- **Engine**: the worker process that schedules node executions, evaluates contracts and edges, and writes events.
- **Scheduler**: a project's switch that lets handoff start runs on its own. Once a person turns it on, the worker starts runs on the plan's Ready tasks, up to a limit of active runs, and starts nothing while a failed run or a pending permission request holds the project. It is not the engine's scheduling of node executions, which the engine does for every run.
- **Size**: how big a task is, S, M or L, in the single select field Size on the plan's GitHub Project. A person sets it on the dashboard, over MCP or on GitHub. The planner proposes a size in its plan, and the dashboard shows a proposal dashed until a person picks a size; only a person's pick reaches GitHub. A Size option other than S, M or L reads as no size. A run records the size its task had when the run started, so a later change does not move old runs between sizes. Epics and stories have no size; they show the sum of their tasks.
- **Estimate**: a task's manual duration in hours, in the Number field Estimate on the plan's GitHub Project. A person types hours or days ("3h", "2d"), and a day is the project's capacity. An estimate overrides the forecast of the task's size. An Estimate of 0 or less reads as no estimate.
- **Forecast**: what a size usually takes in this project: the median wall time of the project's succeeded runs of that size that link exactly one task, split into agent, queue and waiting-on-you time, with the median reported cost and the number of runs. A size with fewer than 5 runs uses its default (S 30m, M 1h, L 2h). handoff computes forecasts from the runs when it reads them and stores none. A run without a recorded size counts under its planner's proposal, else under its task's current Size. A task's duration is its estimate, else the forecast of its Size, else the forecast of its planner's proposal.
- **Capacity**: the person's hours of work a day on a project's plan, 1 to 24, 6 unless changed. A sized task's bar on the timeline is its duration over the capacity, in days, and Arrange fills each day up to it. Every day counts, weekends too. Runs that work at the same time add no capacity.
- **Event**: one row in the events table, streamed to the dashboard. CLI stream-json lines become events.
