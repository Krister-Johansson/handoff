# 8. The scheduler starts runs from Ready tasks in the worker

Date: 2026-10-02. Status: accepted.

## Context

A person started every run. On a planned project that meant a `start_run` per Ready task, then waiting for its pull request to merge before starting the tasks the merge unblocked. Issue #403 asked handoff to work through a planned project on its own, per project, with a limit of active runs. `docs/plans/run-feedback.md` had listed such a scheduler as a non-goal; `docs/plans/scheduler.md` reverses that and plans it.

## Decision

Each project has a scheduler, off until a person turns it on. Its settings and state are one row in `project_schedulers`: on or off, a pause with who paused it and why, `max_runs` (1 to 10), the order (Project order or a Priority field), the graph its runs use, a label whose tasks it skips, and the loop's due time, lease and last result.

- The loop runs in the worker process, next to the engine's loop. Every 5 seconds it looks for projects whose check is due, takes each one's lease so two workers never check one project at once, and checks it. A check is due 60 seconds after the last one. Events that can make a task startable or clear a hold bring it forward (a run ends, a run the scheduler started gets its plan, a merge closes issues, an answer, a permission decision, a repair, a cancel, a resolved loop, `move_to_ready`, a release of a cancelled task, and turning the scheduler on, resuming or changing it), but never closer than 10 seconds after the last check.
- A check counts the project's holds and active runs from Postgres first. Only a failed run (a loop that ran out of rounds included) and a pending permission request hold the project. A run waiting on a question, a review, Try it or the merge queue does not; it counts toward `max_runs`. On a hold, with `max_runs` runs active, or while a run the scheduler started has no plan yet, the check reads nothing from GitHub.
- Otherwise the check reads the Project once and starts the first candidate: an open task in Ready with no open blocker, no active run, not labelled with the skip label, and no cancelled latest run unless a person released it. One check starts at most one run.
- The dashboard's `start_run` and the scheduler share one start function in the engine, `startRun`. It refuses an issue an active run already links, under a per-project advisory lock taken in the transaction that inserts the run, so a person and the scheduler cannot both start the same task.
- `runs.started_by` records who started each run. Project-level events go to their own table, `scheduler_events`, because run events need a run.
- Before the first coder attempt of a run the scheduler started, the worker compares the run's owned paths with those of the project's other active runs and waits while they overlap.

The dashboard was rejected as the host: it has no server-side loop, it need not be running, and a Next.js dev server restarts on edits. A graph node that starts runs was rejected because runs are per task, and a run that starts runs would need cancel and repair to cascade.

## Consequences

- The worker needs Projects access: a classic `GITHUB_TOKEN` with the `project` scope (ADR 0007). Without it the worker logs that the scheduler is off and checks nothing. This changes one point of ADR 0007: the worker now reads the Project, once per check that has a free slot.
- One read of up to 100 Project items costs 4 GraphQL points. At one read a minute that is at most 240 points an hour per project, plus the reads nudges bring forward. Priority order adds one read of the Project's fields to each check that reads the items.
- A task moved to Ready on GitHub's board starts on the next 60 second check, since GitHub sends no webhook for a user-owned Project. `move_to_ready` brings the check forward.
- `max_runs` limits runs and `HANDOFF_CAP_CLI` limits Claude processes; the scheduler never changes the cap. Runs above the cap take turns at their Claude steps.
- Runs waiting on a person fill slots instead of stopping the project, so with `max_runs` 1 nothing new starts while a review waits.
- The scheduler never moves a task to Ready, never requests a merge, and never answers, repairs or cancels a run. A task whose run a person cancelled stays with that person until they start it or release it to the scheduler.
