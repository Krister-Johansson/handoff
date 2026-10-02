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

- **Issues.** A run can link GitHub issues (New run, or `pnpm handoff run --issue 12`). The agents read their bodies, the pull request says `Closes #12`, and the Merge node closes them once the pull request merges.
- **Graph.** Nodes and edges stored as graphology JSON. Each save is a new version, and a run keeps the version it started with.
- **Nodes.** Planner, Coder and Reviewer run Claude. Tester runs a shell command with a minimal environment (`PATH`, `HOME`, locale and `CI=true`, never the worker's tokens or `DATABASE_URL`), because it runs code the agent wrote. List any other variables its tests need under **Environment variables** in the node's settings; the graph stores the names and the worker supplies the values. handoff's own secrets cannot be listed. The PR node pushes the branch, opens the pull request, posts the Reviewer's comments on it as one comment (updated on later attempts), and waits for CI and reviews. Merge squash-merges. A Human gate asks you something.
- **Contracts.** Every node returns structured output that must match its schema, and can have deterministic checks such as "tests pass" or "changes stay within the paths the plan claimed". The engine runs the checks, not the model.
- **Loops.** An edge can loop back, for example from a failed test run to the Coder, with a maximum number of attempts. The Coder gets the failing output in its context. When a loop runs out, the run asks you in the inbox whether to retry or stop.
- **Waiting.** A node that waits for CI, a review or your answer holds no process. Webhooks, or the periodic re-check, wake it.
- **Recovery.** A failed node can be repaired in place from the inbox or with `pnpm handoff run repair`. Everything before it is kept. Rate limits are retried automatically with backoff.

The library (**Library** in the dashboard) holds skills, MCP servers and subagents that nodes enable by name. MCP secrets are written as `${secret:NAME}` and resolved from the worker's environment when a node runs. They are never stored in the database. Git gets the GitHub token through `GIT_CONFIG_*` environment variables, so it does not appear in error messages or the process list, and error messages and command output are scrubbed of token-shaped strings before they are stored.

## The Plan

A project can keep a plan of epics, stories and tasks on GitHub. GitHub holds the whole plan. handoff stores one thing about it: the number of the GitHub Project that belongs to the handoff project.

- **Hierarchy.** Epics, stories and tasks are issues in the project's repository. A story is a sub-issue of its epic and a task is a sub-issue of its story. The labels `epic`, `story` and `task` mark the kind.
- **Status.** Each task has a Status on a GitHub Project (v2) that you own, with the options Shaping, Ready, Running, In review and Done. A closed issue counts as Done whatever its Status says.
- **The Ready gate.** Of the issues in the Project, only open tasks in Ready that no run works on reach the backlog and `list_backlog`. Tasks blocked by an open issue are listed last, and a run will not start on them until the blocker closes. Epics and stories never run. Issues that are not in the Project stay in the backlog as unplanned and can still be started.
- **Status from runs.** handoff sets Running when a run starts on a task, In review when the pull request opens, Done when it merges, and Ready again when you cancel the task's latest run. Each write is a `plan.status` event on the run. A write that cannot happen is a `plan.skipped` event and the run carries on.

### The token

The Plan needs `GITHUB_TOKEN` to be a classic token with the `project` scope. Add the scope and use the token:

```bash
gh auth refresh -s project
GITHUB_TOKEN=$(gh auth token)   # put this value in .env
```

A fine-grained token cannot reach a Project owned by a user account. A GitHub App cannot either: GitHub has a Projects permission only for organizations, and no App permission covers a user's Projects. With only an App, or with a token that lacks the scope, the Plan page and the shaping tools say what is missing, and runs record `plan.skipped` instead of moving tasks.

### Linking a Project

Ask the assistant, or Claude Code with the handoff plugin, to set up the plan. That calls `setup_plan`, which shows an approval card first. It creates the labels `epic`, `story` and `task` if they are missing. With `use` and the number of one of your existing Projects, it links that Project to the repository and sets its Status options to Shaping, Ready, Running, In review and Done; the card names each option it renames or adds. Without `use`, it creates a Project called "<project name> plan" with those options and links it. Either way it stores the Project's number on the handoff project. Running it again on a project that has a plan checks the labels and fields and reports what it found.

### Staying up to date

GitHub sends no webhook when a card moves on a Project owned by a user account. The Plan page reads the Project each time it renders and refreshes itself every 30 seconds while the browser tab is visible. A change made on GitHub's board shows on the dashboard within 30 seconds.

`pnpm dev:webhooks` also relays the repository's `issues`, `sub_issues` and `issue_dependencies` events. handoff stores them with every other delivery. They wake nothing; the Plan page uses the latest one for its "last GitHub activity" line.

## The assistant

The **Assistant** button in the header (or Cmd or Ctrl+J) opens a panel beside every page. Ask what needs you or how a run is going, or tell it to start, answer, merge, repair or cancel something. It can also open pages for you: the inbox for a project, a run, a review or Try it. The panel stays open while the page behind it changes, and earlier conversations are listed in its picker.

- **How it runs.** Each message runs the Claude Code CLI from the dashboard on your subscription, with the same `CLAUDE_CODE_OAUTH_TOKEN`. The CLI gets handoff's tools and nothing else: no shell, no files, no web. Without the token the assistant is off and the panel says so.
- **Approvals.** Reading happens without asking. Anything that changes something (starting, answering, merging, repairing, cancelling, adding a project) shows an approval card with what it will do and the arguments. Nothing happens until you press Approve. Deny takes a note that tells the assistant why. A card nobody answers within 5 minutes counts as denied.
- **Settings.** **Settings, Assistant** switches the assistant off, picks the model (Sonnet by default, or Opus or Haiku) and shows the model that ran last. `.env` sets the defaults: `HANDOFF_ASSISTANT_MODEL`, `HANDOFF_ASSISTANT_EFFORT`, `HANDOFF_ASSISTANT_MAX_TURNS` and `HANDOFF_ASSISTANT_APPROVAL_TIMEOUT_MS`.
- **History.** Conversations are stored in Postgres. `pnpm handoff gc` removes those not used for 30 days, with their transcripts (`--assistant-days` changes that).
- **Browser agents (WebMCP).** In a browser with WebMCP (in Chrome, `chrome://flags/#enable-webmcp-testing`), every dashboard page offers the same tools to an agent in the browser, with the same approval card for changes. The start run form, the inbox's answer forms and the permission cards are declarative WebMCP forms: an agent can fill them, and you press the button. **Settings, Assistant** turns WebMCP off for this browser.

The assistant shares your subscription's limits with the worker's Claude nodes, and `HANDOFF_CAP_CLI` does not count it.

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

The review and Try it pages also have a **Read aloud** button.

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
