---
name: handoff-setup
description: Set up a repository to work well with handoff, or check an existing project's setup. Use when the user wants to start using handoff on a repository, asks what handoff needs, or a run failed because the app, tests or CI were not set up.
---

# Setting up a project for handoff

handoff runs a graph of agents on a GitHub repository: a planner, a coder, a tester, reviews, a Demo step that screenshots the running app, a Try it step where the user checks the app, a pull request and a merge. Each step works in a fresh git worktree of the repository. The setup below is what those steps rely on.

## 1. Check where the project stands

1. `current_project` says which handoff project this folder belongs to. If it has none, `add_project` adds the repository.
2. `setup_project` checks the project and returns one item per requirement, each `ok`, `todo` or `info`, with what it found and how to fix it. `ready` is true once the required items (a graph and a running worker) are in place.
3. Go through the `todo` items one at a time. Tell the user what each one is for before changing anything. Ask before you commit to their repository or push. Run `setup_project` again at the end.

## 2. What each item needs

### A graph (required)

A project needs a graph before it can run. The user creates it on the project's Settings tab in the dashboard, or imports a JSON file with `pnpm handoff graph import --project <name> --name <graph> <file.json>` from the handoff checkout. A graph that works well has: Start, a planner, a reviewer of the plan, a Human gate to approve the plan, a coder, a tester, a code review, a Human gate to approve the build, a Demo step, a Human gate in Try mode, the Pull request node and a Merge node.

### A running worker (required)

The worker runs the steps. Start it with `pnpm dev:worker` in the handoff checkout. It needs `CLAUDE_CODE_OAUTH_TOKEN` and GitHub credentials in handoff's `.env`. Never print or copy those values.

### A setup command

Each run starts in a fresh worktree with no dependencies installed. Set the project's setup command in Settings, Projects, for example `pnpm install --frozen-lockfile` or `npm ci`. It runs once per worktree, before the first step that needs it. It sees `HANDOFF_RUN_ID`, `HANDOFF_RUN_SHORT` and `HANDOFF_WORKTREE`, so tests that need their own database can name it per run, for example by copying `.env.example` to `.env` with the test database named after `HANDOFF_RUN_SHORT`. The teardown command, next to it, runs when handoff removes the worktree and drops what setup made.

Agent notes, in the same form, are facts every agent step reads about the project's environment, such as "the database container is shared and already running". They are stored as plain text: never put secrets in them.

### CLAUDE.md

Every agent step reads the repository's `CLAUDE.md`. Write one with:
- the commands to install, run, test, lint and typecheck;
- how the code is laid out and where new code goes;
- the conventions to follow (naming, tests first, commit style);
- what not to touch.

Keep it short and factual. Agents follow it literally.

### An app that starts from .claude/launch.json

The Demo and Try it steps start the run's app from the worktree using `.claude/launch.json`, the same file Claude Code desktop uses for its Preview. handoff gives each run's app a free port in the `PORT` environment variable, so several runs can preview at once.

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "port": 5173,
      "autoPort": true,
      "env": { "DATABASE_URL": "postgresql://app:app@localhost:5432/app" }
    }
  ]
}
```

- Make the dev server listen on `PORT`. For Vite, set `server: { port: Number(process.env.PORT) || 5173 }` in `vite.config.ts` and drop any `--port` from the dev script. Next.js reads `PORT` already.
- Do not use port 3000 as the default: the handoff dashboard runs there.
- A worktree has no `.env`. Put the local, non-secret values the app needs to boot (a local database URL from `docker-compose.yml`, for example) in the configuration's `env`. Never put secrets there; the file is committed.
- If the app needs services such as a database, keep them in the repository's `docker-compose.yml`. handoff starts them once per project, and uses the user's own stack when it already holds the ports.
- If the app needs a migration before it starts, run it in the command, for example `"runtimeExecutable": "sh", "runtimeArgs": ["-c", "pnpm exec prisma migrate deploy && pnpm dev"]`.

### CI on pull requests

The PR node waits for the repository's checks before the merge. Without CI, a run can merge red code. Add a GitHub Actions workflow that runs on `pull_request` and runs lint, typecheck and tests, with the services the tests need.

### Acceptance criteria in issues

handoff reads acceptance criteria from each issue: the checkboxes under a heading such as `## Acceptance criteria`, or every checkbox when there is no such heading. The Demo step takes one screenshot per criterion, and the Try it step shows them as a checklist. Write them as things a person can check in the running app:

```markdown
## Acceptance criteria
- [ ] A user can create a new project from the sidebar
- [ ] The new project shows in the sidebar without a reload
```

When an issue has none, the planner writes its own, and the user approves them with the plan.

### Issue dependencies

When issues build on each other, add a line such as `Depends on: #12` to the later issue, then use Link dependencies on the project's Issues tab. handoff turns those lines into GitHub's own blocked-by links. A blocked issue cannot start a run, and its pull request does not merge until the blocker closes.

### GitHub webhooks

CI results and reviews wake a waiting run at once when webhooks reach handoff. Without them, runs notice on their next check, every few minutes. While runs are active, keep `pnpm dev:webhooks <owner>/<repo>` running in the handoff checkout, or install handoff's GitHub App.

### A plan on GitHub Projects

A plan is optional. It holds epics, stories and tasks on a GitHub Project of the user's, and only tasks in Ready reach the backlog. `setup_plan` creates:

- the labels `epic`, `story` and `task` on the repository;
- a GitHub Project owned by the user, named after the project, with the Status columns Shaping, Ready, Running, In review and Done, linked to the repository.

Call `list_github_projects` first and ask the user whether to use one of their existing Projects instead (`setup_plan` with `use`). Using one renames Status options that already match apart from case or emoji, adds the missing ones, and keeps every other option. Running `setup_plan` again creates nothing new: it adds labels someone removed and reports Status options the Project lacks.

The plan needs the dashboard's `GITHUB_TOKEN` to be a classic token with the `project` scope. Run `gh auth refresh -s project`, then set `GITHUB_TOKEN=$(gh auth token)` in handoff's `.env` and restart the dashboard and the worker. A GitHub App cannot reach a Project owned by a user, and a fine-grained token cannot either.

## 3. After the setup

Run `setup_project` again and tell the user what is in place and what is left. Then the normal flow applies (see the `handoff` skill): plan the work as issues, `start_run`, and follow it with `get_run`.
