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
2. **GitHub.** For personal use, set `GITHUB_TOKEN` (the output of `gh auth token` works). For a team setup, create a GitHub App instead and set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH`. The App needs read and write access to contents and pull requests, read access to checks and actions, and the events `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `check_suite`, `check_run` and `workflow_run`.
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

1. Open **Projects** and add the repository as `owner/name`. Use a throwaway repository first.
2. Create a graph from the template **Plan, code, test, review, PR, merge with retry loops**.
3. In the editor, select the **Test** node and set its command to whatever proves the change works in that repository, for example `npm test`. Save.
4. Press **Run**, describe the task, and watch the run page.

The same flow from a terminal:

```bash
pnpm handoff project add --name sandbox --repo owner/name
pnpm handoff graph import --project sandbox --name loop packages/core/src/fixtures/loop.graph.json
pnpm handoff run --project sandbox --graph loop --task "Add a CONTRIBUTING.md" --follow
```

To look around without GitHub or Claude, `pnpm demo` seeds a demo run with simulated Claude output, and `pnpm demo:reset` removes it again.

## How a run works

- **Graph.** Nodes and edges stored as graphology JSON. Each save is a new version, and a run keeps the version it started with.
- **Nodes.** Planner, Coder and Reviewer run Claude. Tester runs a shell command with a minimal environment (`PATH`, `HOME`, locale and `CI=true`, never the worker's tokens or `DATABASE_URL`), because it runs code the agent wrote. The PR node pushes the branch, opens the pull request and waits for CI and reviews. Merge squash-merges. A Human gate asks you something.
- **Contracts.** Every node returns structured output that must match its schema, and can have deterministic checks such as "tests pass" or "changes stay within the paths the plan claimed". The engine runs the checks, not the model.
- **Loops.** An edge can loop back, for example from a failed test run to the Coder, with a maximum number of attempts. The Coder gets the failing output in its context. When a loop runs out, the run asks you in the inbox whether to retry or stop.
- **Waiting.** A node that waits for CI, a review or your answer holds no process. Webhooks, or the periodic re-check, wake it.
- **Recovery.** A failed node can be repaired in place from the inbox or with `pnpm handoff run repair`. Everything before it is kept. Rate limits are retried automatically with backoff.

The library (**Library** in the dashboard) holds skills, MCP servers and subagents that nodes enable by name. MCP secrets are written as `${secret:NAME}` and resolved from the worker's environment when a node runs. They are never stored in the database. Git gets the GitHub token through `GIT_CONFIG_*` environment variables, so it does not appear in error messages or the process list, and error messages and command output are scrubbed of token-shaped strings before they are stored.

## Running each run in a container

```bash
pnpm docker:runner
```

Then set `HANDOFF_WORKSPACE=docker` in `.env`. Each run gets its own container from the runner image (Node 24, git and the pinned Claude CLI), with the worktree mounted at the same path. Claude, the Tester and command checks run inside it, and the container is removed when the run ends. `HANDOFF_DOCKER_NETWORK` puts the containers on a network you control, for example one with restricted egress.

## Costs and limits

Claude usage counts against your subscription's limits, shared with your own Claude use. The cost figures on the run page are estimates reported by the CLI, not a bill. By default only one Claude node runs at a time (`HANDOFF_CAP_CLI=1`); raise it if your plan allows.

handoff is meant for your own use with your own Claude login. Anthropic does not allow third-party products to route other people's requests through their Claude subscriptions, so sharing a handoff instance with other users would need API keys instead.

## Development

The project is built test-first. `CLAUDE.md` has the working rules and commands, `docs/plan.md` the design, `docs/adr/` the decisions, and `GLOSSARY.md` the vocabulary.

```bash
pnpm test         # unit, integration (needs pnpm db:up) and web tests
pnpm typecheck
pnpm lint
```

The Claude CLI version is pinned in `HANDOFF_CLAUDE_VERSION`. The worker refuses to start with a different version, because the CLI docs say `--bare` will become the default for `-p`, and bare mode ignores subscription logins. Check the changelog before bumping it.
