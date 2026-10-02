# Run feedback: fixes from two days on the todoOverKill backlog

## Context

From 2026-10-01 to 2026-10-02 an agent session ran the todoOverKill backlog through handoff (graph `master` v9 to v19). It made 46 runs and merged 47 pull requests. On 2026-10-02 alone, twelve steps failed and seven of the twelve were the same check, `diff_within_paths`. The session wrote two documents: an improvement report with twelve ranked items, and a log with an errors table, observations and a timestamped session log. This plan takes every item in the report, checks it against the code on `main` (commit `ea66a3d`), and turns what is still missing into PRs.

Some of what the report asks for is already on `main` but was not available to that session. The installed plugin was 0.2.0, the repository's plugin is 0.3.0, and a Claude Code session keeps the tool list it saw at start. Those items are listed under "Already on main" and need no code.

The plan follows `docs/plan.md`: verified facts first, then decisions, design, and PRs with their first failing tests at the seams named in `CLAUDE.md`.

## Goals

- A later attempt of a node knows what earlier attempts were told: allowed extra paths, repair notes and answers to its questions.
- A failed path check asks a person instead of failing the run, and package manager files count as one unit.
- Tests in one run cannot wipe another run's data, and a tester failure that a re-run clears does not send finished work back to the coder.
- A branch that only merged main does not repeat code review and the human gates.
- A code review's verdict follows its findings, and a plan review never asks for code.
- Everything a person answers on the run page can be answered over MCP, and a waiting step says what it waits on.
- The demo step fits the change: no demo for a change with no UI, seeded data, the build that ships, and the server log and browser console shown at the gate.
- A failure says why it failed, and the worktree stays until a person has looked.
- "Run again" can continue from the failed run's branch.
- The planner keeps plans small and can propose a split, and it knows about the other active runs.

## Non-goals

- A scheduler that starts runs on its own ("run the unblocked backlog with at most N at a time"). The project management plan covers the backlog; starting runs automatically is a separate decision. Reversed on 2026-10-02 at the user's request: `docs/plans/scheduler.md` plans the scheduler, and ADR 0008 records the decision.
- Moving the MCP endpoint out of the dashboard into the worker. The report names the dashboard as a single point of failure; this plan adds a startup check and leaves the process layout as it is.
- Rebasing branches. Updating a branch stays a merge of the base branch, as `syncWithBase` does today.
- A database per run created by handoff itself. handoff does not know a project's database; it gives the project's setup command what it needs to create one (see Decision 3).

## Already on main

Checked in the code on `main`. These need the plugin update and a fresh Claude Code session, not new code.

- `answer_permission` (allow or deny, with an optional deny message) is a catalog tool (`apps/web/src/lib/assistant/catalog.ts:231-245`).
- `resolve_loop` with `retry`, `continue` or `stop` gives MCP the run page's "Another round", "Go on as if approved" and "Stop" (`catalog.ts:180-191`).
- `dismiss_attention` dismisses finished items, and finished items older than one day drop out of `list_attention` (`apps/web/src/server/attention.ts:32-40, 62-68`).
- The channel sends `finished` messages (commit bccd15f).
- A question can carry a short summary for notifications (PR 352).
- `diff_within_paths` names the files outside the owned paths in its failure (`packages/engine/src/contract/checks.ts:149`).
- The planner prompt already says to keep `plan` short and not to repeat the steps, and the constraints already ask for no commit trailers.

## Verified facts

Code facts are from `main` at `ea66a3d`, read on 2026-10-02.

### Contract and attempts

- `diff_within_paths` (`packages/engine/src/contract/checks.ts:141-150`) allows `check.paths ?? state.plan.ownedPaths`, plus `extraPathsOf(ctx.output)`. `ctx.output` is the current execution's output only (`contract/validate.ts:28`). It diffs the whole branch against `origin/<base>` and counts uncommitted and untracked files (`:103-111`). So a file an earlier attempt declared fails every later attempt that does not declare it again.
- `extraPaths` is on `CoderOutputSchema` only (`packages/core/src/schema/outputs.ts:37`).
- `selectContext` (`packages/engine/src/context.ts:120-170`) builds an attempt's context. `priorAttempt` and `humanAnswer` come only from the node that sent the work back. The repair note is read from `execution.repairNote`, which only the repaired row has (`operations.ts:29`, `context.ts:168`).
- A question gate's answer reaches only the execution triggered by the gate's edge, which resumes the old CLI session when the last output was `needs_input` (`executors/cli-node.ts:91-99, 139-148`). Later attempts start new sessions. Question answers are not written to `state.decisions`; only approval gates write there (`executors/human-gate.ts:232-235`). So the code reviewer never sees them either.
- Every edge leaving a feedback port is a loop with `maxAttempts` 3 by default (`packages/core/src/graph/compile.ts:108-112`). The question gate's `answered` port is a feedback port (`graph/ports.ts:30-53`), so each answer uses one round, and the fourth answer in a run exhausts the edge (`engine/src/complete.ts:74-88`).
- "Go on as if approved" (`resolveExhaustedLoop` with `continue`, `operations.ts:149-170`) throws for a question gate, because its only way out is the loop.

### Worktrees, setup and the tester

- A worktree is created when a node first needs one, with `git worktree add` from handoff's clone (`packages/engine/src/workdir/git-worktree.ts:31-54`). It is removed with `--force` as soon as the run is succeeded, failed or cancelled (`apps/worker/src/scheduler/worker.ts:365-381`). A repair re-creates it from the branch, so uncommitted and ignored files are gone.
- `projects.setup_command` runs once per worktree with a minimal environment and a 20-minute timeout, skipped by a hash marker (`workdir/setup.ts:15-39`, `worker.ts:280`). todoOverKill had none, which is why repaired worktrees had no `node_modules` and no `.env`.
- The tester runs `node.config.command` with no retry. A failing command completes with `passed: false` and leaves through `fail`, a feedback port wired to the coder (`executors/tester.ts:10-23`).
- No per-run database name, port or other per-run value reaches the setup command, the tester or the agents.
- Agents are told the worktree is "on this run's branch" but not the branch's name (only `code_review` gets it), not whether setup ran, and nothing about shared services. The only environment note is "Do not use port 3000" (`packages/core/src/context/render.ts:159, 175`).
- There is no per-project notes field.

### Branch updates

- The PR node's `syncWithBase` (`executors/github.ts:131-149`) merges the base locally when the branch is behind. On a conflict it aborts and leaves through `fix`, which the templates wire to the coder. The coder then runs again, and after it come the tester, code review and both human gates.
- The merge node goes back to the PR node through an `update` port when GitHub reports a conflict or the branch is behind, but no template has an `update` edge, so a conflict there fails with `merge_conflict` (`github.ts:322-389`).
- `fix` is one port for conflicts, failing CI and requested changes, because the compiled graph allows one edge per node pair (`docs/plans/stacked-prs.md`, verified facts).

### Review

- Code review and the plan reviewer share `reviewer_output`: `{ verdict: "approve" | "request_changes", comments: [{ path, line?, body }] }` with no severity (`outputs.ts:46-49`).
- The code review prompt says to request changes only for a finding that makes the change wrong, insecure or misses the task (`cli-node.ts:63-70`). Later rounds get the earlier comments and the commit they reviewed, but only after a `request_changes` verdict (`context.ts:107-118`, `render.ts:138-154`).
- "Plan, not code" is only in the template node's instructions (`fixtures/plan-review.graph.json:39`). The built-in reviewer prompt says to review "the changes on this branch, unless the step's instructions name something else".
- "Approve after fixes" is a gate answer, `fix`, that routes like `changes` and approves that gate the next time it runs (`human-gate.ts:186-193, 216-228`).

### MCP and notifications

- `get_run` (`apps/web/src/server/agent-mcp.ts:60-99`) returns steps, open questions with stored options, `failed` with the error message only, and `stuck` without the last reviewer comment. It has no pending permission prompts, no Try it content (the gate stores `acceptance`, `preview` and `shots` in its context, `human-gate.ts:173`), no cost and no answered gates.
- Review gates store options `["approve", "changes"]` (`human-gate.ts:120`). `answer_question` does not validate `option` against them, so `fix` works but is not advertised.
- `list_attention` has no permission prompts. Failed and stuck runs stay until repaired, resolved or cancelled, and only finished items can be dismissed.
- `get_project` returns graph names without versions (`agent-mcp.ts:135-145`).
- handoff shortens notification bodies to 140 characters (`apps/web/src/lib/brief.ts`). No 300-character cut exists in the repository.
- `start_run` refuses issues blocked on GitHub; `run_again` skips that check (`apps/web/src/server/graphs.ts:180-185, 212`). Nothing compares files between active runs.

### Permissions and scheduling

- Planner and reviewer nodes allow `Read, Glob, Grep` and `Bash(git log|show|diff|status|ls-files *)`; code review adds `Skill` and a few more git commands; demo has read tools and Playwright (`packages/core/src/graph/catalog.ts:27-38`).
- "Always allow" offers `Bash(<first word> *)` (`apps/web/src/lib/permission.ts:15-21`) and saves it into a new graph version.
- One queue of `pending` executions with caps per executor kind; Claude nodes default to one at a time (`HANDOFF_CAP_CLI=1`, `apps/worker/src/env.ts:14`). A step waiting on a permission prompt keeps its Claude process and its slot for up to 30 minutes (`engine/src/permissions/broker.ts:14`).
- PR and merge waits release their lease and are woken by webhooks or deadlines (`complete.ts:295-328`).
- Execution statuses are `pending, running, waiting, passed, failed, repaired` (`packages/db/src/schema/enums.ts:4-11`). The web derives `sent_back` from `edge_traversals` rows that the engine writes only for fan-in edges (`apps/web/src/server/queries.ts:102-114`, `complete.ts:91-93`).

### Failures, demo and run again

- A max-turns failure stores `cli_error_max_turns` with a generic message. The turn count is parsed but not stored, and the agent's last message and the cost are dropped (`cli-node.ts:262-276`, `executor.ts:163`). An agent that reports `failed` becomes `contract_failed: node reported failed` (`validate.ts:24`).
- The turn budget is `config.maxTurns`, default 60, the same for every plan size (`context.ts:4, 128`).
- The demo starts the first configuration in the repository's `.claude/launch.json` on a free port, starts compose services shared per project, and takes screenshots through Playwright MCP (`engine/src/preview/preview.ts`, `executors/demo.ts`). It does not seed data. It writes the server log to a file that only a start failure reads, and it does not capture the browser console or a build. Nothing skips it.
- `runAgain` starts the latest graph version from the planner on a new branch from the default branch, with only the task and issues (`graphs.ts:199-211`). Nothing marks the old run as superseded.
- Runs are pinned to their graph version, and the run page shows it, but its link opens the latest version in the editor.
- The run header's status badge does not change on `loop.resolved` or `node.repair_requested` (`apps/web/src/components/runs/run-live.tsx:165`, `lib/status.ts:47-53`).
- The dashboard reads GitHub credentials on first use and has no startup check (`apps/web/src/lib/github.ts:11-15`).

## Unverified

- How Claude Code matches a `Bash(cat *)` rule against a compound command such as `cat a | grep b` or `cd x && ls`. Decision 6 depends on it; check the Claude Code permissions docs through Context7 before PR 6.
- Why a green PR waited 8 to 12 minutes for the worker while agent steps ran (issues 100 and 38). PR and merge waits do not hold a Claude slot, so the candidates are the reconcile deadline without webhooks and the per-process limit of four executions. PR 6 starts by reproducing it with a fake GitHub.
- Where the report's "about 300 characters" cut happens. handoff cuts at 140, so it is probably the channel display in Claude Code. Not relied on: get_run carries the full text either way.
- Whether `git patch-id` is stable enough for Decision 4. The design does not use it; it fingerprints added and removed lines instead.

## Decisions

### 1. Run memory per node

Each node gets a memory on the run: `state.memory[nodeKey] = { extraPaths, notes, answers }`.

- `extraPaths`: every path a coder attempt declared, with its reason and attempt, and every path a person allowed (Decision 2).
- `notes`: every repair note, with the attempt it was given to.
- `answers`: every question the node asked at a question gate, with the person's answer and option.

The context packet renders the memory as "Earlier in this run" for every attempt of that node. `diff_within_paths` allows the owned paths, the memory's paths and the current output's `extraPaths`. Question answers are also written to `state.decisions`, so the code reviewer and every later node see what a person decided.

An answer at a question gate does not use a loop round. A person decided each one, so the round limit there only stops a run that a person wanted to continue. The `answered` edge stays a loop for the graph's structure, with no limit.

The planner does not get `extraPaths`. Its `ownedPaths` is the list, and its prompt says so.

### 2. A path check that asks

When `diff_within_paths` is the only failing check, the coder's attempt waits instead of failing, with a question: "The coder changed files outside the plan: `<files>`". The answers are "Allow for this run", which adds the files to the node's memory and passes the attempt, "Send back", which gives the coder the files and a note, and "Fail the step". Any other failing check still fails the attempt.

Package manager files count as one unit: when `package.json` in a directory is owned, its lockfile (`pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb`) and `pnpm-workspace.yaml` at the repository root are owned too.

`repair_run` and the run page's repair form take `allowPaths`, added to the node's memory.

### 3. The project's setup prepares each worktree; the tester retries once

handoff gives the setup command, the tester and every agent the run's identity: `HANDOFF_RUN_ID`, `HANDOFF_RUN_SHORT` (the first eight characters) and `HANDOFF_WORKTREE`. A project that needs its own database per run creates it in its setup command, for example by copying `.env.example` to `.env` and naming the test database `<name>_${HANDOFF_RUN_SHORT}`. A new `projects.teardown_command` runs when the worktree is removed, to drop what setup made.

Project readiness warns when the repository has a lockfile and the project has no setup command, and suggests one.

The tester gets `retries` (default 1): a failing command runs once more, and a pass on the retry passes with a note that the first run failed. A tester failure where the shell did not find a command it runs (exit 127, or the shell's own "not found" line for that command) fails the step as an environment failure instead of going to the coder. Any other failure goes to the coder with its output.

### 4. Approvals hold until the change changes

At each approval (code review approve, human gate approve) handoff records a fingerprint of the branch's own change: for each file in `git diff -U0 <merge-base>...HEAD`, the sorted added and removed lines, hashed. Before a code review or an approval gate runs again, handoff computes the fingerprint again. When it matches the fingerprint at the last approval of that node, the node passes with "Unchanged since your approval at <time>; only <base> was merged in", and the event log says so. The tester and CI still run.

The fingerprint ignores context lines and line numbers, so a merge of main that resolves a conflict in a neighbouring line keeps it. A resolution that changes the run's own lines changes it, and the gates run as before.

The templates gain the merge node's `update` edge back to the PR node, so a branch that falls behind at merge time is updated without a coder step. Git commands that reach the network (`fetch`, `push`) retry three times with backoff.

### 5. Findings carry a severity, and the verdict follows

`reviewer_output` comments gain `severity: "blocking" | "should_fix" | "follow_up"`. The engine derives the verdict: any blocking finding is `request_changes`, otherwise `approve`, whatever the model wrote. The prompt defines blocking: a defect a user can hit on the main path of the change, a security hole, a broken accessibility requirement the project states, or a failing acceptance criterion.

Later rounds get the earlier findings with every verdict, not only after `request_changes`, and the prompt asks for each one's status and limits new findings on unchanged lines to `follow_up` unless they are blocking.

The reviewer's prompt states the stage. Before any coder-type node has passed in the run, it reads: "Stage: plan. No code exists for this run yet; review the plan in the run state and never ask for an implementation." This moves the template's sentence into the engine.

The code review gate gets "Create follow-up issue": the person picks findings and handoff opens one issue with them, linked to the run's issue (a sub-issue when the project has a plan).

### 6. Everything on the run page is on MCP, and a wait says what it waits on

- `get_run` adds pending permission prompts with the full command, the Try it content (app URL, criteria, the demo's notes per criterion), the cost, the failure's code and detail (Decision 8), the last reviewer comment on a stuck loop, and answered gates with their answers.
- Review gates store their options as `approve`, `changes` and `fix`. `answer_question` refuses an option the question does not list and accepts a verdict per criterion for Try it gates.
- `list_attention` includes permission prompts. Failed items can be dismissed, and a superseded run (Decision 9) leaves the list.
- `get_project` returns each graph's latest version.
- A step's current state is one of `queued` (pending, with its place in the queue), `running`, or `waiting` with `waiting_on: permission | question | ci | merge_queue | worker`. list_runs and get_run report it.
- A step that waits on a permission prompt does not count against the Claude cap while it waits.
- The default allow list of planner, reviewer, code review and demo nodes adds read-only commands that cannot write files, if the Unverified check shows compound commands are matched per part. The candidates are `cat`, `head`, `tail`, `wc`, `ls`, `grep`, `rg` and `git branch`. `sed`, `find` and `node -e` stay out because they can write or run code. The planner prompt says to read installed versions from `node_modules/<pkg>/package.json` with the Read tool.
- "Always allow" offers the first two words for commands with subcommands (`Bash(git show *)`, `Bash(pnpm list *)`) and never offers a rule for `cd`, `node`, `sh`, `bash` or `env`.

### 7. A demo that fits the change

- The demo node gets `when: "always" | "ui_changes"`, default `ui_changes` in the templates. A project lists its UI paths (default globs for routes, pages, components and styles). When the change touches none, the demo leaves through a new `skipped` port, which the templates wire past the Try it gate to the PR node. The skip is an event with the reason.
- The demo starts the `.claude/launch.json` configuration named `handoff-demo` when there is one, else the first, so a project can demo its production build.
- `projects.demo_seed_command` runs after compose services start and before the app starts.
- The demo node gets `passEnv` like the tester: names of variables the worker passes from its own environment, so a feature that needs a key can be shown. Values never go into the graph or the database.
- The demo agent reads the browser console through Playwright and returns it in its output. handoff reads the server log. The Try it gate shows warnings and errors from both, marking those not seen in the project's previous demo as new. A console error or an unhandled rejection fails the demo with the messages.

### 8. Failures say why, and the worktree stays

- A Claude node's failure stores the CLI's result subtype, the turn count, the cost and the agent's last message. The run page's failure summary and get_run show them.
- `maxTurns: "auto"` on coder nodes, the template default, is 40 plus 4 per plan step, at most 150.
- When a coder ends with `error_max_turns` after its wrap-up turn and has committed work, handoff starts one new attempt that continues from the branch with "Continue: the previous attempt ran out of turns" and its last message, before failing.
- A failed run's worktree stays until the run is repaired, run again, cancelled, or removed by `handoff gc` after 7 days. Cancel removes it even when nothing is running.

### 9. Run again continues

"Run again" asks where to start: from scratch, or from the failed run's branch (the default when the branch has commits). From the branch, the new run's branch starts at the old branch's head, and its planner gets "An earlier run of this task" with the old plan, the decisions, the open review findings and the branch name. The old run is marked superseded by the new one (`runs.superseded_by`) and cancelled. Run again checks blockers like `start_run`.

### 10. Small plans, aware of each other

- The planner gets a size budget, a project setting with defaults of 15 files and 12 steps. Over budget, it returns `status: "split"` with parts, each with a title, a body and its owned paths.
- The plan gate shows a split as its own answer, "Split as proposed". handoff opens one issue per part after the first (sub-issues of the run's issue when the project has a plan, with `Depends on` links otherwise) and narrows the run to the first part. This is a split into separate runs. Stacked PRs (`docs/plans/stacked-prs.md`) remain the way to deliver one issue as a stack in one run.
- The planner's context lists the other active runs on the project with their issues, branches and owned paths, and open handoff PRs with their changed files. The plan gate shows overlaps between this plan's owned paths and those.
- The context names the run's branch and says not to create another. It includes the issue's comments (newest first, within the same 4,000-character budget as the body), and every planner attempt re-reads the issues from GitHub.
- When the coder's first attempt starts and the branch has no commits, the worker fast-forwards the worktree to the latest base, so the coder works on the newest main.
- `projects.agent_notes` is free text every node's context includes under "About this project's environment", for facts such as "the database container is shared and already running". It must not hold secrets; the settings form says so.

## Design

### Data model

- `projects`: `teardown_command text`, `demo_seed_command text`, `ui_paths text[]`, `plan_budget jsonb` (`{ files, steps }`), `agent_notes text`.
- `runs`: `superseded_by uuid` referencing `runs`.
- `node_executions`: `waiting_on text` (null, `permission`, `question`, `ci`, `merge_queue`).
- Run state (JSON, no migration): `memory`, `approvals` (fingerprints per node), `previousRun`.
- `reviewer_output` comments: `severity`. Old outputs without it read as `should_fix`.

### Engine

- `context.ts` adds `memory` to every packet and `render.ts` renders "Earlier in this run". `complete.ts` appends to memory when a coder output declares `extraPaths`, when a repair is requested, and when a question is answered.
- `contract/checks.ts`: `diff_within_paths` reads the memory and expands package manager units. `contract/validate.ts` reports a lone path failure as `paths_outside_plan` with the files, and the worker turns it into a waiting execution with a question (`kind: "paths"`).
- `graph/compile.ts`: loop edges from a human gate's `answered` port get no limit.
- `executors/tester.ts`: retries, the environment-failure check, run identity in the environment.
- A new `approvals.ts`: `ownDiffFingerprint(workdir, base)` and the skip check, called from the code review path in `cli-node.ts` and from `human-gate.ts`.
- `executors/github.ts`: retries for network git commands.
- `executors/demo.ts` and `preview/preview.ts`: `when`, the `skipped` port, the named launch configuration, the seed command, `passEnv`, console and log capture.
- `cli-node.ts`: the failure detail, `maxTurns: "auto"`, the continue attempt.

### Worker

- `scheduler/worker.ts`: keep a failed run's worktree; run the teardown command on removal; pass run identity to setup; fast-forward before the first coder attempt.
- `packages/db/src/ops/claim.ts`: executions with `waiting_on = 'permission'` do not count against the Claude cap.

### Web and MCP

- `server/agent-mcp.ts`: the get_run additions, options validation, permission items, the `queued` and `waiting_on` state, graph versions.
- `server/attention.ts`: permission items, dismissing failed items, superseded runs.
- `server/graphs.ts`: run again from a branch, the blocker check.
- `components/runs`: failure detail, the paths question card, the pending state on the stuck-loop buttons, the badge on `loop.resolved` and `node.repair_requested`.
- `components/review`: severities on code review and follow-up issues, the split answer on plan review, warnings on Try it.
- `lib/permission.ts`: the two-word rule.
- Project settings: teardown, seed, UI paths, plan budget, agent notes.
- `instrumentation.ts`: log a warning at startup when no GitHub credentials are set.

## Delivery

One issue, one branch and one PR per step, CI green, `pnpm doctor:react` clean after changes under `apps/web`, a red-green slice per test named here, and Context7 before code against Next.js, Drizzle, Zod, Octokit, Vitest or the Claude Code CLI. The order follows the report's suggested order, which is also the order of time lost.

1. **Run memory.** Files: `packages/engine/src/context.ts`, `complete.ts`, `contract/checks.ts`, `executors/human-gate.ts`, `packages/core/src/context/render.ts`, `graph/compile.ts`. First tests: `engine/src/run-memory.integration.test.ts` "a path declared in extraPaths by attempt 1 passes diff_within_paths in attempt 3 without being declared again"; "a repair note reaches every later attempt of the node, not only the repaired one"; "a question answered at a gate reaches a later attempt that the tester sent back, in a new session"; "a question answer is in decisions, so the code reviewer's packet has it"; "a fourth answer at a question gate routes to the coder instead of exhausting the edge". `core/src/context/render.test.ts` "Earlier in this run lists allowed paths, notes and answers".
2. **A path check that asks, and failures that say why.** Files: `contract/checks.ts`, `contract/validate.ts`, `apps/worker/src/scheduler/worker.ts`, `cli-node.ts`, `operations.ts`, web run components and repair form. First tests: `contract/checks.test.ts` "owning package.json owns its lockfile and pnpm-workspace.yaml"; `engine/src/paths-question.integration.test.ts` "a lone path failure waits with a paths question naming the files"; "Allow for this run passes the attempt and the next attempt may change the file"; "Send back gives the coder the files"; "a path failure with another failing check fails as before"; "repair with allowPaths adds the paths"; `cli-node.integration.test.ts` (fake claude) "a max-turns failure stores the subtype, turn count, cost and last message"; `worker.integration.test.ts` "a failed run keeps its worktree until it is repaired or cancelled".
3. **Worktree setup and the tester.** Files: `workdir/setup.ts`, `scheduler/worker.ts`, `executors/tester.ts`, `packages/db/src/schema/projects.ts` (teardown, agent notes) and a migration, `render.ts`, `apps/web/src/server/readiness.ts`, project settings. First tests: `workdir/setup.integration.test.ts` "the setup command sees HANDOFF_RUN_ID, HANDOFF_RUN_SHORT and HANDOFF_WORKTREE"; "the teardown command runs when the worktree is removed"; `executors/tester.test.ts` "a failing command passes on its retry with a note"; "a command that is not found fails as an environment failure and does not go to the coder"; `render.test.ts` "the packet names the run's branch, whether setup ran, and the project's agent notes"; `readiness.integration.test.ts` "a repository with a lockfile and no setup command gets a warning with a suggestion"; `worker.integration.test.ts` "the first coder attempt starts on the latest base when the branch has no commits".
4. **Approvals hold until the change changes.** Files: new `packages/engine/src/approvals.ts`, `cli-node.ts`, `executors/human-gate.ts`, `executors/github.ts`, the three templates. First tests: `approvals.integration.test.ts` (real git in a temp repo) "the fingerprint is the same after merging a base that changed a neighbouring line"; "the fingerprint changes when the run's own lines change"; `human-gate.integration.test.ts` "an approval gate passes without a question when the fingerprint matches its last approval"; `cli-node.integration.test.ts` "code review is skipped with the earlier verdict when the fingerprint matches"; `github.integration.test.ts` "a fetch that fails twice and then succeeds does not fail the step"; `fixtures.test.ts` "every template wires the merge node's update port to the PR node".
5. **Review severities.** Files: `packages/core/src/schema/outputs.ts`, `cli-node.ts`, `context.ts`, `render.ts`, `apps/web/src/components/review`, a server action for follow-up issues. First tests: `outputs.test.ts` "a comment without severity reads as should_fix"; `cli-node.integration.test.ts` "a review that says approve with a blocking finding routes as request_changes"; "a review that says request_changes with no blocking finding routes as approve"; `render.test.ts` "a reviewer before any coder has passed is told it reviews a plan and must not ask for code"; "a later review gets the earlier findings after an approve verdict too"; `code-review.test.tsx` "findings are grouped by severity"; "Create follow-up issue opens one issue with the chosen findings".
6. **MCP and waits.** Files: `server/agent-mcp.ts`, `server/attention.ts`, `executors/human-gate.ts`, `operations.ts`, `packages/db/src/ops/claim.ts`, `packages/db/src/schema` (`waiting_on`) and a migration, `core/src/graph/catalog.ts`, `lib/permission.ts`. First tests: `agent-mcp.integration.test.ts` "get_run lists a pending permission prompt with the full command"; "get_run on a Try it gate has the app URL, the criteria and the demo's notes"; "get_run has the cost, the failure code and the answered gates"; "a review gate lists approve, changes and fix, and answer_question refuses an option it does not list"; "list_attention has permission prompts and a failed item can be dismissed"; "get_project returns each graph's latest version"; "a pending step reports queued with its place"; `claim.integration.test.ts` "a step waiting on a permission prompt does not hold the Claude slot"; `permission.test.ts` "Always allow offers git show, not git, and nothing for cd or node". The Unverified check on Bash rule matching comes first; the allow list change follows its answer.
7. **The demo fits the change.** Files: `executors/demo.ts`, `preview/preview.ts`, `core/src/preview/launch.ts`, `graph/ports.ts`, `schema/outputs.ts`, the templates, `projects.ts` (seed command, UI paths) and a migration, `components/review/try-review.tsx`. First tests: `demo.integration.test.ts` "a change with no file under the UI paths leaves through skipped with the reason"; "the seed command runs after services start and before the app"; "a passEnv variable reaches the app"; "a console error in the demo's output fails the step with the message"; `launch.test.ts` "the handoff-demo configuration wins over the first"; `try-review.test.tsx` "new warnings from the server log and the console are marked new".
8. **Run again continues.** Files: `server/graphs.ts`, `packages/engine/src/runs.ts`, `runs` schema and a migration, `render.ts`, `server/attention.ts`, run page. First tests: `graphs.integration.test.ts` "run again from the branch starts the new branch at the old head and gives the planner the old plan, decisions and open findings"; "run again marks the old run superseded and cancels it"; "run again refuses a blocked issue"; `attention.integration.test.ts` "a superseded run is not in list_attention".
9. **Small plans, aware of each other.** Files: `schema/outputs.ts` (planner `split`), `cli-node.ts`, `context.ts`, `render.ts`, `executors/human-gate.ts`, `components/review/plan-review.tsx`, `server/graphs.ts`, `projects.ts` (plan budget) and a migration. First tests: `render.test.ts` "the planner's packet has the size budget, the other active runs' owned paths, the open handoff PRs' files and the issue comments"; `cli-node.integration.test.ts` "a planner over budget returns split and the plan gate offers Split as proposed"; `plan-split.integration.test.ts` (FakeGitHub) "Split as proposed opens an issue per later part with Depends on links and narrows the run to the first"; "with a plan, the parts are sub-issues of the run's issue"; `plan-review.test.tsx` "overlapping owned paths are listed with the run that owns them".
10. **Dashboard fixes.** Files: `components/runs/run-live.tsx`, `lib/status.ts`, `stuck-loop-card.tsx`, `try-review.tsx`, `run page`, `instrumentation.ts`, `complete.ts` (loop traversals). First tests: `run-live.test.tsx` "the badge leaves failed on loop.resolved and on node.repair_requested"; `stuck-loop-card.test.tsx` "the chosen button shows that it is working until the page refreshes"; `try-review.test.tsx` "Approve submits in one click when every criterion works"; "the app link updates when the app is started again"; `queries.integration.test.ts` "a step the tester sent back reads sent back"; the run page's graph link opens the pinned version.

## Risks

| Risk | Mitigation |
| --- | --- |
| Allowing paths from memory lets a run drift far from its plan. | Only paths a coder declared with a reason or a person allowed enter memory; the code review gate lists them under "Files outside the plan". |
| A matching fingerprint skips a review that a merge from main made necessary (main changed an API the branch calls). | The tester and CI still run after every merge. A project can turn the skip off per gate. |
| The derived verdict sends more work back when a model over-labels findings as blocking. | The prompt defines blocking narrowly; the loop's round limit and the gate remain. Watch the share of blocking findings in the next run. |
| Read-only Bash rules allow more than intended through compound commands. | The allow list changes only after the Unverified check, and keeps out every command that can write or run code. |
| A retried tester hides a genuinely flaky test. | A pass on retry is recorded with a note, shown at the code gate. |
| Keeping failed worktrees fills the disk. | `handoff gc` removes them after 7 days, and the gc report lists them. |
| Releasing the Claude slot during a permission wait lets two Claude processes run against a cap of one. | The waiting process is idle; when the answer comes, the step waits for a slot before its process continues. |

## Open questions

Recommended answers in brackets; the plan uses them unless decided otherwise.

1. Should a question gate's answers count against the loop's round limit at all? [No.]
2. Should a change with no UI skip the demo and the Try it gate entirely, or show a gate with the test results as evidence? [Skip both; the code gate stays.]
3. Should the engine override a review's verdict from its severities, or only warn when they disagree? [Override.]
4. Should a step waiting on a permission prompt release the Claude slot? [Yes.]
5. Default plan budget. [15 files, 12 steps.]
6. Should "Run again" default to continuing from the failed branch when it has commits? [Yes.]
7. How long should a failed run's worktree stay? [7 days, or until repair, run again or cancel.]

## Verification

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm doctor:react` pass after each PR.
2. Update the installed plugin to the repository's version and start a fresh Claude Code session; `answer_permission`, `resolve_loop` and `dismiss_attention` are listed.
3. On todoOverKill with `diff_within_paths` on again: a coder that adds a dependency passes with the lockfile and workspace file; a file outside the plan gets the paths question; after "Allow for this run", later attempts and a conflict loop pass.
4. With a setup command that names a test database per run, two runs' test suites run at the same time without failures from each other.
5. Merge one PR while another run waits at its demo gate: the waiting run merges main and reaches the PR again without a code review or a gate.
6. A code review with a blocking finding sends the work back on its own; the gate shows severities and creates a follow-up issue.
7. A backend-only issue goes from the code gate to the PR with no demo.
8. A planner over budget proposes a split; "Split as proposed" opens the issues and the run continues with the first part.
9. Over MCP alone, without the dashboard in a browser: answer a permission prompt, a Try it gate with verdicts per criterion, and a stuck loop.
