# handoff implementation plan

## Context

handoff is a graph-engineering orchestrator for coding agents, built from the ideas in the 2026 graph engineering guide (aibuilderclub.com) and Naresh B A's ContractGraph article: nodes with one responsibility, shared run state flowing along edges, contracts validated deterministically by the engine, bounded loops, and repair of a failed node in place instead of restarting a run. The user builds a graph of specialised agent nodes for a GitHub project, a run executes it, a PR node opens a pull request, waits for CI and review webhooks, and routes feedback back to the Coder node in a bounded loop.

This plan is written for a fresh Claude session (Opus 5.5) that has not seen the design conversation. Everything it needs is here, in `CLAUDE.md` and in `GLOSSARY.md`, both binding. The repo at `/Users/krister/Project/handoff` (GitHub: Krister-Johansson/handoff) currently holds only `CLAUDE.md`, `GLOSSARY.md`, `docs/agents/*.md`, `skills-lock.json` and eleven installed skills under `.claude/skills/`. Nothing is committed yet.

Decisions the user made for delivery:
- The first end-to-end run targets a throwaway sample GitHub repo, never handoff itself.
- Each milestone below becomes one GitHub issue on Krister-Johansson/handoff (see `docs/agents/issue-tracker.md`), created at the start of implementation with `gh issue create`, worked in order, and closed by its PR.
- Each milestone is a branch and a PR with CI running the tests. The initial bootstrap files already in the working tree are the first commit on `main`.

## Verified facts the design depends on

Verified against official docs and the local machine on 2026-09-29. Re-verify with Context7 before coding against any of them.

- Claude Code CLI 2.1.285 is installed. `claude -p` with a Pro or Max subscription counts against the subscription. Bare mode (`--bare`) never reads OAuth credentials, the keychain or `CLAUDE_CODE_OAUTH_TOKEN`, so it cannot be used. The headless docs say bare mode will become the default for `-p` in a future release, so the CLI version is pinned and checked at worker start.
- `claude setup-token` mints a one-year subscription token consumed through `CLAUDE_CODE_OAUTH_TOKEN`, which takes precedence over keychain credentials. It can only make model requests, which is all a Coder needs. `CLAUDE_CONFIG_DIR` relocates the config and session directory.
- Anthropic's legal page allows an end user to sign in to the unmodified Claude Code binary with their own subscription, including inside sandboxes, with usage billed to that user. It forbids third parties from collecting, storing or intermediating claude.ai credentials. handoff is a personal tool, so the first case applies. Shipping it to other people would require API keys through the Agent SDK. The Agent SDK is not used.
- Stream-json is newline-delimited. `system/init` carries `session_id`, so it can be persisted before the run ends. Only the final `result` line carries `total_cost_usd`, `usage`, `structured_output` and `permission_denials`. `stream_event` lines appear only with `--include-partial-messages`, which is not passed. Exit code 143 on SIGTERM, 130 on SIGINT. A resumed session reuses the system prompt recorded at its first request, so a human answer or retry feedback must be delivered in the prompt, not through `--append-system-prompt-file`.
- `--permission-prompts none` (2.1.259 or later) denies anything that would prompt and removes `AskUserQuestion`. Questions are a contract outcome instead (status `needs_input`).
- `--mcp-config` with `-p` blocks until servers connect, up to `MCP_TIMEOUT` (30 s default). `system/init` reports `mcp_servers`, `mcp_server_errors`, `plugins`, `plugin_errors`.
- Google ADK for TypeScript and LangGraph.js were evaluated and rejected. ADK's TS graph workflows are marked experimental in 2.1.0 and cross-process resume is undocumented for TypeScript. LangGraph.js re-runs a node from its start on resume, which replays side effects such as commits and PR creation. The engine is custom and small.
- Local toolchain: Node 24.18, pnpm 12.6, Docker Desktop 28.5 with Compose v2, `gh` 2.101 logged in as Krister-Johansson, ngrok 3.39 installed with a valid config, `postgres:17-alpine` image already pulled.
- Current package versions: next 16.3.7, react 19.3.0, drizzle-orm 1.0.0-rc.4 (0.45.3 legacy), drizzle-kit 1.0.0-rc.4, vitest 5.0.2, @xyflow/react 12.12.0, graphology 0.26.0, zod 4.6.5, octokit 5.0.5, pg 8.23.0, tsx 4.23.15, typescript 5.9.3 (pin 5.x, not 7.x, until Next and Vitest document TS 7 support).

## Working rules for the implementing session

- Read `CLAUDE.md`, `GLOSSARY.md` and this plan first. Use the installed skills: `tdd` for every slice, `vitest`, `drizzle-best-practices`, `github-webhooks`, `react-flow`, `vercel-react-best-practices`, `frontend-design`, `webapp-testing`.
- Test first at the seams named in `CLAUDE.md`. Each bullet under "first tests" in a milestone is one red-green slice. Test names use glossary vocabulary. Assert through public interfaces, never raw SQL.
- Context7 before writing code against any library: Vitest 5 project config, Drizzle rc API, graphology export format, Zod 4 `toJSONSchema`, Octokit App auth, Next 16 route handlers and streaming, @xyflow/react 12, Claude Code CLI flags.
- Run `npx react-doctor@latest apps/web` after every change under `apps/web`.
- Pin every dependency exactly. Commit migrations. Never run `drizzle-kit push`.

## Repo layout

pnpm workspace, six workspace packages. Packages are drawn where two consumers exist. The dashboard must import the schemas, graph compiler and condition evaluator without pulling in `child_process`, git or Octokit, and the worker must not import Next.js.

```
handoff/
  CLAUDE.md  GLOSSARY.md  skills-lock.json  .claude/        (existing)
  docs/agents/                                              (existing)
  docs/adr/0001..0005                                       (milestone 0)
  package.json                 private, root scripts, packageManager pnpm@12.6.0, engines node>=24
  pnpm-workspace.yaml          packages: ["apps/*", "packages/*"]
  tsconfig.base.json
  vitest.config.ts             projects: unit, integration, web
  docker-compose.yml           postgres:17-alpine on 5433, creates handoff and handoff_test
  .env.example  .gitignore     (.env, .handoff/, node_modules, .next)
  .github/workflows/ci.yml     postgres service, pnpm install, typecheck, lint, test
  scripts/db-init.sql
  packages/
    core/          @handoff/core      pure, isomorphic: Zod schemas, graph compile, condition DSL, contract registry, packet rendering, React Flow mapping
    db/            @handoff/db        Drizzle schema, migrations, client, ops (claim, wake, events, repair), test fixture
    cli-adapter/   @handoff/cli-adapter  CliExecutor interface, Claude implementation, stream-json parser, fake binary
    github/        @handoff/github    GitHub App auth, signature verification, webhook normalisation, PR and checks calls, FakeGitHub
    engine/        @handoff/engine    scheduler, lease, routing, contract checks, context selection, node executors, library materialiser, workdir providers
  apps/
    worker/        @handoff/worker    bin `handoff`: worker loop and operator CLI (project add, graph import, run, answer, repair, cancel)
    web/           @handoff/web       Next.js App Router dashboard
  .handoff/                    gitignored runtime dir: repos/, worktrees/, staging/, claude-config/, github-app.pem
```

Dependency direction: `core <- db <- engine`, `core <- cli-adapter <- engine`, `core <- github <- engine`, `engine <- worker`, `web -> core, db, github`. `core`, `cli-adapter` and `github` never import `db`.

Packages are source-only (`"exports": {".": "./src/index.ts"}`, `"type": "module"`). Next.js consumes them through `transpilePackages`; the worker runs through `tsx`; Vitest reads TypeScript natively. Typecheck is `tsc --noEmit` per package.

### Key files inside the packages

```
packages/core/src/
  schema/graph.ts        GraphDocumentSchema, NodeAttributesSchema, EdgeAttributesSchema, NodeTypeSchema
  schema/contracts.ts    ContractSchema, DeterministicCheckSchema, ContextSelectorSchema, contractRegistry
  schema/outputs.ts      PlannerOutputSchema, CoderOutputSchema, ReviewerOutputSchema, TesterOutputSchema, PrOutputSchema, FeedbackSchema, HumanAnswerSchema
  schema/run-state.ts    RunStateSchema, mergeState()
  conditions/schema.ts   ConditionSchema
  conditions/evaluate.ts evaluateCondition(condition, ctx)
  graph/compile.ts       compileGraph(document) -> CompiledGraph (graphology DirectedGraph + validation errors)
  graph/catalog.ts       node type catalog: executor kind, default config, default contract, default allowed tools
  graph/routing.ts       nextEdges(compiled, nodeKey, outcome, ctx)
  graph/react-flow.ts    toReactFlow(document) / fromReactFlow(nodes, edges)   (milestone 4)
  context/render.ts      renderContextPacket(packet) -> markdown
  fixtures/linear.graph.json  loop.graph.json
packages/db/src/
  client.ts              createDb(url) with drizzle-orm/node-postgres and pg.Pool
  schema/*.ts            one file per table, enums.ts, index.ts barrel
  ops/claim.ts           claimNext(db, {workerId, freeKinds, leaseMs})
  ops/wake.ts            wakeByKey(), wakeByToken()
  ops/events.ts          appendEvents(tx, runId, rows), listEventsAfter(runId, seq, limit)
  ops/repair.ts          repairNodeExecution(db, executionId, {note})
  migrate.ts             programmatic migrate()
  testing/global-setup.ts  starts a Postgres container (Testcontainers) unless TEST_DATABASE_URL is set, migrates, provides the URL to tests
  testing/reset.ts       truncate all tables
packages/cli-adapter/src/
  types.ts               CliExecutor, CliRunRequest, CliRun, CliRunResult, CliEvent
  claude/argv.ts         buildClaudeArgv(req)
  claude/env.ts          buildClaudeEnv({oauthToken, configDir, passthrough})
  claude/executor.ts     ClaudeCliExecutor
  claude/result.ts       validateResult(resultLine, contract)
  stream-json/parser.ts  createStreamJsonParser()
  stream-json/schema.ts  StreamJsonLineSchema (loose, unknown types pass through)
  events.ts              toEventRows(ids, line)
  testing/fake-claude/bin.mjs    fake binary
  testing/fixtures/*.jsonl       done, needs_input, max_turns, resume, garbage
  testing/fake-executor.ts       in-memory FakeCliExecutor for engine tests
packages/github/src/
  verify-signature.ts    verifyGitHubSignature(rawBody, header, secret)
  webhook-events.ts      WebhookEnvelopeSchema, normaliseWebhook(), correlationKeys()
  app-client.ts          GitHubPort interface + OctokitGitHubApp (installation tokens per call)
  pull-requests.ts       createOrUpdatePr(), getPrState(), mergePr()
  checks.ts              getCheckState(), getFailedJobLogs()
  testing/fake-github.ts in-memory GitHubPort
  testing/sign.ts        signPayload(secret, body)
  fixtures/*.json        recorded payloads: check_suite, check_run, pull_request_review, issue_comment
packages/engine/src/
  worker.ts              startWorker(deps) -> { stop() }
  scheduler/claim-loop.ts  lease.ts (heartbeat, reapExpiredLeases, reapExpiredWaits)  execute.ts  complete.ts
  routing/route.ts       routeFromNode()   routing/join.ts   routing/loop-guard.ts
  contract/validate.ts   contract/checks/{tests_green,diff_within_paths,pr_exists,no_uncommitted_changes,command}.ts + registry.ts
  context/select.ts      selectContext(selector, state, workdir) -> ContextPacket
  executors/registry.ts  executors/{planner,coder,reviewer,tester,pr,merge,human-gate,function}.ts
  library/materialize.ts materializeLibrary(exec, config) -> {addDir, mcpConfigPath, cleanup()}   (milestone 3)
  workdir/provider.ts    WorkdirProvider interface   workdir/git-worktree.ts   workdir/docker.ts (milestone 6)
apps/worker/src/         main.ts  cli.ts  env.ts (Zod EnvSchema)
apps/web/src/app/
  runs/page.tsx  runs/[runId]/page.tsx  inbox/page.tsx (M5)  projects/[id]/graphs/[graphId]/page.tsx (M4)
  api/runs/route.ts  api/runs/[runId]/events/route.ts (SSE)  api/webhooks/github/route.ts
  api/questions/[id]/answer/route.ts (M2)  api/graphs/[graphId]/route.ts (M4)  api/library/... (M3)
apps/web/src/components/ event-stream.tsx  run-status.tsx  graph-editor/ (M4)
```

## Data model

Conventions: uuid primary keys with `defaultRandom()`, `timestamptz`, `jsonb` typed with `$type<>` from `@handoff/core`, snake_case columns, one schema file per table, enums in `enums.ts`. Drizzle `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`, driver `drizzle-orm/node-postgres`. Fallback if the RC misbehaves: 0.45.3 plus `relations()`; the builder code is identical. Keep `db.query` relational queries out of the codebase so a downgrade is a version bump.

Enums:
- `run_status`: queued, running, waiting, succeeded, failed, cancelled
- `node_execution_status`: pending, running, waiting, passed, failed, repaired
- `executor_kind`: cli, shell, github, human, function
- `wait_kind`: github_pr, human, timer
- `mcp_transport`: stdio, http

Tables:

| table | columns |
|---|---|
| `github_installations` | id, installation_id bigint unique, account_login, account_type, suspended_at null, created_at, updated_at. No tokens stored. |
| `projects` | id, name unique, github_installation_id fk null, repo_id bigint unique (GitHub numeric id), repo_owner, repo_name, default_branch, local_clone_path null, created_at, updated_at |
| `graphs` | id, project_id fk, name, latest_version int default 0, created_at, updated_at |
| `graph_versions` | id, graph_id fk, version int, document jsonb `$type<GraphDocument>`, created_by, created_at; unique (graph_id, version). Runs pin a graph_version_id. |
| `runs` | id, project_id, graph_version_id, status run_status, task text, state jsonb `$type<RunState>`, state_version int default 0, next_event_seq bigint default 0, base_branch, branch_name, worktree_path null, pr_number int null, cancel_requested_at null, started_at, finished_at, created_at, updated_at. Indexes (project_id, created_at desc), (status). |
| `node_executions` | id, run_id fk, node_key text, node_type text, executor_kind, attempt int, status, runnable_at default now(), lease_owner null, lease_expires_at null, heartbeat_at null, reclaim_count int default 0, interrupt_count int default 0, wait_kind null, wait_key null, wait_token uuid null unique, wait_deadline_at null, wake_requested_at null, wake_reason null, wake_payload jsonb null, context_packet jsonb null, output jsonb null, checks jsonb null, error jsonb null, executor_session_id text null, cost_usd numeric(12,6) null, usage jsonb null, repaired_from_execution_id uuid null self fk, repair_note null, claimed_at, started_at, finished_at, created_at, updated_at. Unique (run_id, node_key, attempt). Partial indexes: (executor_kind, runnable_at, created_at) where status = 'pending'; (lease_expires_at) where status = 'running'; (wait_deadline_at) where status = 'waiting'; (wait_key) where status in ('running','waiting'); (run_id, created_at). |
| `edge_traversals` | id, run_id, edge_key, from_execution_id, to_node_key, consumed_by_execution_id null, created_at. Index (run_id, to_node_key) where consumed_by_execution_id is null. Fan-in bookkeeping that stays correct across loop re-entry. |
| `events` | id bigint identity, run_id, seq bigint, node_execution_id null, type text, payload jsonb, created_at. Unique (run_id, seq) is the SSE tail index. `seq` is allocated from `runs.next_event_seq` under the run row lock in the same transaction, so a reader that has seen seq k never later sees a smaller seq. |
| `webhook_deliveries` | id, delivery_id text unique (X-GitHub-Delivery), event_name, action null, installation_id bigint, repo_id bigint null, correlation_keys text[], payload jsonb, received_at, processed_at null, woke_execution_ids uuid[] default '{}'. Insert `on conflict do nothing`; a conflict returns 200 with no side effects. |
| `questions` (M2) | id, run_id, node_execution_id, question text, options jsonb, answer text null, answered_by null, answered_at null, created_at |
| `skills`, `skill_versions` (M3) | skills(id, name unique); skill_versions(id, skill_id, version, description, body text, files jsonb `{path, content}[]`); unique (skill_id, version) |
| `mcp_servers`, `mcp_server_versions` (M3) | mcp_servers(id, name unique); mcp_server_versions(id, mcp_server_id, version, transport, command null, args text[] null, url null, env_template jsonb, headers_template jsonb, default_tool_allowlist text[]). Template values may contain `${secret:NAME}`, substituted from the engine environment at materialisation and never written back. |
| `workers` | id text pk, hostname, caps jsonb, started_at, heartbeat_at, stopped_at null. Operational only; leases are what matter for correctness. |

Idempotency:
- Webhook redelivery: unique delivery_id.
- Duplicate wakeups: `wakeByKey` and `wakeByToken` are conditional updates (waiting to pending only; a running execution only gets `wake_requested_at` set). The PR executor re-reads PR state from GitHub on every run, so N wakeups converge.
- Worker crash: lease expiry returns the row to pending with `reclaim_count + 1`. The Coder re-claims with `--resume executor_session_id` (persisted at `system/init`). The PR executor looks the PR up by head branch before creating one. `reclaim_count >= 2` fails the execution with `error.code = 'reclaim_limit'`.
- Completion is one transaction: mark passed, merge state, evaluate edges, insert next executions, insert events.
- Human answers: `update ... where wait_token = $t and status = 'waiting'`; zero rows means already answered (409).

## Zod schemas and interfaces (in `@handoff/core`)

- `NodeTypeSchema`: planner, coder, reviewer, tester, pr, human_gate, merge, function. Catalog maps type to executor kind: planner, coder, reviewer are cli; tester is shell; pr and merge are github; human_gate is human; function is function.
- `NodeAttributesSchema`: `{ type, label, config, contract: Contract, contextSelector: ContextSelector, library?: { skills: string[], mcp: string[] }, x, y }`.
- `EdgeAttributesSchema`: `{ condition?: Condition, on?: 'passed'|'failed'|'any' (default passed), loop: boolean, maxAttempts?: number, onExhausted?: nodeKey, priority?: number, overrides?: { skills?, mcp? } }` with refinement `loop` requires `maxAttempts`.
- `GraphDocumentSchema`: graphology export `{ attributes: { startNode, exhaustedGate? }, options: { type: 'directed', multi, allowSelfLoops }, nodes: [{ key, attributes }], edges: [{ key, source, target, attributes }] }`.
- `ContextSelectorSchema`: `{ stateKeys: string[], repoPaths: string[], includeFeedback: boolean, includePriorAttempt: boolean }`.
- `ContractSchema`: `{ output: ContractName, checks: DeterministicCheck[] }`. `contractRegistry: Record<ContractName, ZodType>`; `compileGraph` rejects unknown names. `--json-schema` is produced with `z.toJSONSchema(schema)`.
- `DeterministicCheckSchema`: discriminated union `tests_green {command, timeoutMs}`, `diff_within_paths {paths}`, `pr_exists`, `no_uncommitted_changes`, `command {command, expectExitCode}`.
- Outputs: `PlannerOutputSchema { plan, steps[], ownedPaths[] }`; `CoderOutputSchema { status: 'done'|'failed'|'needs_input', summary, question?: {text, options?}, filesChanged?, commitSha? }` with refinement needs_input requires question; `ReviewerOutputSchema { verdict: 'approve'|'request_changes', comments[{path, line?, body}] }`; `TesterOutputSchema { passed, command, exitCode, tail }`; `PrOutputSchema { prNumber, prUrl, headSha, feedback: Feedback }`; `FeedbackSchema { ci: { status: pending|success|failure, failedJobs[{name, jobId, url, logExcerpt}] }, review: { decision: none|approved|changes_requested|commented, comments[{author, path?, line?, body, url, resolved}], unresolvedThreads }, updatedAt }`; `HumanAnswerSchema { answer, option?, approved?, answeredBy, answeredAt }`.
- `RunStateSchema` (loose object): `{ task, plan?, diffSummary?, testResults?, prNumber?, feedback?, loops: Record<edgeKey, {attempts}>, nodes: Record<nodeKey, {output, executionId, attempt, sessionId?, lastFailure?: {checks, error}}>, human: Record<nodeKey, HumanAnswer> }`.
- `ContextPacketSchema`: `{ task, stateSlice, repoPaths, feedback?, priorAttempt?: { summary, failedChecks: CheckResult[], reviewComments }, humanAnswer?, repairNote?, constraints: { ownedPaths, allowedTools, maxTurns }, outputContract }`.
- `CheckResultSchema`: `{ kind, passed, detail, logTail?, durationMs }`.

Condition DSL (`conditions/schema.ts`), a JSON predicate validated by Zod at save, path-checkable at compile, renderable as a form in the editor. JS expressions are rejected (code execution driven by the database), JSONLogic is rejected (untyped, poor errors), jsonpath is a selector not a predicate.

```
Condition =
  | { always: true }
  | { eq: [Path, Json] } | { neq: [Path, Json] }
  | { gt|gte|lt|lte: [Path, number] }
  | { in: [Path, Json[]] }
  | { exists: Path }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
Path = "state.<dotted>" | "node.<dotted>" | "edge.<dotted>"
ctx = { state: RunState, node: { key, status, attempt, output, checks }, edge: { key, maxAttempts } }
```

Examples: CI failed back to Coder on a loop edge `pr->coder` with `loop: true, maxAttempts: 3, onExhausted: "gate"`: `{ "eq": ["state.feedback.ci.status", "failure"] }`. Approved and green to Merge: `{ "all": [ { "eq": ["state.feedback.ci.status", "success"] }, { "eq": ["state.feedback.review.decision", "approved"] }, { "eq": ["state.feedback.review.unresolvedThreads", 0] } ] }`. Coder needs input to Human gate: `{ "eq": ["node.output.status", "needs_input"] }`.

Interfaces:

```ts
interface CliExecutor { run(req: CliRunRequest, opts: { signal: AbortSignal; onSessionId?(id: string): void }): CliRun }
type CliRunRequest = { prompt: string; cwd: string; systemPromptFile: string; allowedTools: string[]; maxTurns: number;
  jsonSchema: object; contract: ZodType; mcpConfigPath?: string; addDirs: string[]; sessionName: string;
  resumeSessionId?: string; timeoutMs: number; idleTimeoutMs?: number }
type CliRun = { events: AsyncIterable<CliEvent>; result: Promise<CliRunResult> }
type CliRunResult = { outcome: 'success'|'error_max_turns'|'error_structured_output'|'error'|'interrupted'|'timeout';
  sessionId?: string; structuredOutput?: unknown; validated?: unknown; validationIssues?: ZodIssue[];
  costUsd?: number; usage?: unknown; permissionDenials?: unknown[]; exitCode: number|null; signal?: string; stderrTail: string }

interface WorkdirProvider { acquire(run): Promise<{ path, headSha }>; release(run): Promise<void>; spawn(run, cmd, args, opts): ChildProcess }
// GitWorktreeProvider now (bare clone per repo, `git worktree add <root>/runs/<runId> -b <branch> origin/<base>`), DockerWorkdirProvider in M6 (spawn becomes docker exec).

interface NodeExecutor { type; configSchema; execute(input, ctx: { signal, emit, setSessionId, registerWait }): Promise<ExecutorOutcome> }
type ExecutorOutcome = { kind: 'completed', output, statePatch } | { kind: 'waiting', wait: { kind, key, token?, deadlineAt? } } | { kind: 'failed', error } | { kind: 'interrupted' }

interface GitHubPort { getPrByHead(); createPr(); updatePr(); getPrState(); getCheckState(); getFailedJobLogs(); mergePr(); pushBranch() }
```

## Engine behaviour

Worker deps are injected: `{ db, executors, workdirProvider, github, clock, workerId, caps, leaseMs = 60_000, pollIntervalMs = 1_000, maxInFlight }`. Caps from env: `HANDOFF_CAP_CLI=1` (one subscription rate limit), `HANDOFF_CAP_SHELL=4`, `HANDOFF_CAP_GITHUB=4`, `HANDOFF_CAP_FUNCTION=8`; human is unbounded because the gate only registers a wait and yields.

Tick: every 30 s run `reapExpiredLeases` (running rows with `lease_expires_at < now()` return to pending with `reclaim_count + 1`, fail at 2, event `node.reclaimed`) and `reapExpiredWaits` (waiting rows past `wait_deadline_at` become pending with `wake_reason = 'timeout'`). While in-flight is below `maxInFlight`, `claimNext`.

Claim, one short transaction:

```sql
select pg_advisory_xact_lock(hashtext('handoff.claim'));
select executor_kind, count(*) from node_executions where status = 'running' group by 1;   -- compute freeKinds from caps
select ne.id from node_executions ne join runs r on r.id = ne.run_id
 where ne.status = 'pending' and ne.runnable_at <= now() and ne.executor_kind = any($freeKinds)
   and r.status in ('queued','running','waiting')
 order by ne.runnable_at, ne.created_at limit 1 for update of ne skip locked;
update node_executions set status = 'running', lease_owner = $w, lease_expires_at = now() + $lease,
  claimed_at = now(), started_at = coalesce(started_at, now()) where id = $id returning *;
insert into events ... 'node.claimed'
```

The advisory lock makes the per-kind cap exact across workers. Lock state lives in columns, the claim transaction lasts milliseconds, and no transaction is held across a CLI run.

Execute: load run and graph version, `compileGraph` (memoised per graph_version_id). Start heartbeat every `leaseMs/3`: `update ... set lease_expires_at = now() + $lease, heartbeat_at = now() where id = $id and lease_owner = $w and status = 'running'` also returning `runs.cancel_requested_at`. Zero rows means the lease was reaped: abort the executor and discard. Non-null cancel aborts and marks failed with `error.code = 'cancelled'`. Then `selectContext`, `renderContextPacket` into the staging dir, store `context_packet`. For cli nodes, `materializeLibrary` (M3). Run the executor. `emit` batches events (flush every 100 ms or 50 rows). `registerWait(key)` sets `wait_key` while still running so a webhook that lands before the yield is caught.

On completed: `validateContract` parses output with the named contract, then runs every declared check (all of them, so the retry packet carries the full picture). Coder checks run only when status is done; needs_input passes without checks; failed fails. Pass: `completePassed` in one transaction with the run row locked: mark passed, merge state (`nodes[key] = {output, executionId, attempt}`, `state_version + 1`), `routeFromNode`, update run status (succeeded when nothing is pending or waiting and no edge was taken), insert events. Fail: `completeFailed` with checks and error, then routing with outcome failed.

On waiting: `yieldWaiting` sets status to pending if `wake_requested_at > claimed_at` else waiting, records wait_kind, wait_key, wait_token, wait_deadline_at (default 10 min reconcile for github_pr), clears the lease. Run status becomes waiting when nothing else is pending or running.

On interrupted (shutdown): `releaseForReclaim` sets pending, clears the lease, bumps `interrupt_count`, keeps `executor_session_id`.

Routing (`routeFromNode`, using the compiled graphology `DirectedGraph`): `graph.outEdges(nodeKey)` filtered by `on` against the outcome, then `evaluateCondition`; every matching edge is taken (fan-out). Loop edge: `applyLoopGuard` reads `state.loops[edgeKey].attempts`; below `maxAttempts` increments and takes it; otherwise emits `edge.exhausted` and creates an execution for `edge.onExhausted` or the graph's `exhaustedGate` with `{ reason: 'loop_exhausted', edgeKey }` in its context. Targets with in-degree above one on non-loop edges go through `arriveAtJoin` (insert an `edge_traversals` row) and `joinSatisfied(mode)`: `all` needs an unconsumed traversal for every non-loop in-edge, `any` fires on first arrival and absorbs later ones while a target execution is pending, running or waiting. Otherwise insert `node_executions` with `attempt = max + 1`. Failure with no matching `on: failed` edge: run failed, event `run.failed` with `awaiting: 'repair'`.

Repair (`repairNodeExecution`): requires status failed; inserts a new pending execution for the same node with attempt + 1, `repaired_from_execution_id`, `repair_note`; flips run from failed to running. Run state is untouched, so upstream results stay. When the new execution passes, the old one is marked repaired and routing continues. Repairs do not count against loop `maxAttempts`.

Graceful shutdown: on SIGINT or SIGTERM stop claiming, abort every in-flight signal. The CLI executor sends SIGINT to the child, waits 10 s, then SIGTERM, then SIGKILL after 5 s, and resolves interrupted (exit 143 or 130 is expected, not a failure). The engine calls `releaseForReclaim`, flushes events, ends the pool. On startup the worker kills orphans by reading `.handoff/exec/<execution_id>/child.pid` files on its host and checks `claude --version` equals `HANDOFF_CLAUDE_VERSION`, refusing to start on mismatch unless `HANDOFF_ALLOW_CLI_DRIFT=1`. It logs the argv template once so the operator can see `--bare` is absent.

Context packet rendered to `<staging>/context.md`, fixed sections: Task, Run state (fenced JSON of the state slice only), Repository context, Constraints (owned paths, tool allowlist, turn budget, commit expectations), Output contract, Previous attempt (retries only: Failed checks with the last 80 lines of each log tail, Review comments unresolved only as `path:line - author: body`, Human answer, Operator note). Never the event history. Since a resumed session keeps its first system prompt, human answers and retry feedback are passed in the prompt on `--resume`; the packet file is authoritative only for the first attempt of a session. Loop retries start a new session unless node config says `resumeOnRetry`.

The Coder's environment never contains a GitHub credential. The PR executor pushes with an installation token minted per operation and passed through `git -c http.extraheader=...`, never written to `.git/config`.

## CLI adapter

`buildClaudeArgv` (pure): `['-p', '--output-format','stream-json','--verbose','--json-schema', JSON.stringify(schema), '--permission-mode','acceptEdits','--permission-prompts','none','--allowedTools', tools.join(','), '--max-turns', n, '--append-system-prompt-file', file, '--settings','{"disableAllHooks":true}','--strict-mcp-config', ...(mcp ? ['--mcp-config', path] : []), ...addDirs.flatMap(d => ['--add-dir', d]), ...(resume ? ['--resume', id] : ['--name', name])]`. The prompt goes on stdin. Only one of `--name` and `--resume` is passed. A unit test asserts `--bare` is never present, permanently. `--no-session-persistence` is never passed (resume needs the session).

`buildClaudeEnv`: minimal env (`PATH`, `HOME`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR=<HANDOFF_HOME>/claude-config`, `MCP_TIMEOUT`), drops `ANTHROPIC_API_KEY` so the subscription login is used, passes through an allowlist (`FAKE_CLAUDE_*` in tests).

Parser: async generator over the child's stdout, splits on newline, tolerates CRLF, buffers a trailing partial line until the next chunk, flushes on end. Each line: `JSON.parse` then `StreamJsonLineSchema.safeParse` (loose object with `type`); parse failure yields `{ type: 'raw', text }`. stderr is read line by line into `{ type: 'stderr', text }` and a bounded `stderrTail` ring buffer. Unknown JSON types pass through.

Event mapping: `type = 'cli.' + line.type + (subtype ? '.' + subtype : '')`, payload is the line capped at 256 KB (tool results truncated with a marker). The first line carrying `session_id` (normally `system/init`) triggers `onSessionId`, which the engine writes to `executor_session_id` immediately.

Result: `result` subtype maps to outcome; `structured_output` is `safeParse`d with the contract; missing on success is `error_structured_output`. Max turns: outcome `error_max_turns`; default policy re-queues once with `--resume` and a "finish and emit the output contract" prompt, then fails. Timeout: `timeoutMs` overall and `idleTimeoutMs` (no stdout line) escalate SIGINT, SIGTERM, SIGKILL and resolve timeout. Exit codes: 0 with a result line uses it; non-zero with a result line uses the subtype; non-zero without one is error with `stderrTail`; 143 or 130 is interrupted when we sent the signal, error otherwise. An `api_retry` event with `error: authentication_failed` fails the execution immediately with an operator-readable message; `rate_limit` is an event and the CLI retries; a rate-limit result marks the execution failed with `retryable: true` and `runnable_at = now() + backoff`.

Fake binary `packages/cli-adapter/src/testing/fake-claude/bin.mjs` (plain Node, no deps): reads `FAKE_CLAUDE_FIXTURE` (`{ lines | jsonlPath, lineDelayMs, stderrLines, exitCode, edits: [{path, content}], gitCommit?, hangAfterLine?, chunkSplit? }`), records `{ argv, stdin, cwd, env }` to `FAKE_CLAUDE_RECORD`, applies edits in cwd (optionally `git add -A && git commit`), writes lines to stdout with delays (optionally splitting a line across writes), exits with `exitCode`; on SIGINT exits 130, on SIGTERM 143. Tests construct `new ClaudeCliExecutor({ command: { file: process.execPath, prefixArgs: [fakeBinPath] } })`; production reads `HANDOFF_CLAUDE_BIN` (default `claude`).

## GitHub integration

GitHub App, not a PAT: installation tokens per repo, signed webhooks, check runs and reviews posted as the app. Permissions: contents read and write, pull_requests read and write, checks read, actions read (job logs), metadata read. Events: check_suite, check_run, pull_request, pull_request_review, pull_request_review_comment, issue_comment, workflow_run.

Webhook route (`apps/web/src/app/api/webhooks/github/route.ts`): read the raw body, verify `X-Hub-Signature-256` (HMAC-SHA256, timing-safe compare, follow the github-webhooks skill), answer ping with 200, insert into `webhook_deliveries` on conflict do nothing (200 on redelivery), compute correlation keys (`gh:pr:<repo_id>:<pr_number>` from the PR number or from the check's head SHA via pull_requests in the payload), `wakeByKey`, record `github.webhook` event. The handler is dumb; decisions happen in the PR executor, which re-reads PR and check state from the API on every wake and fetches failed job logs through the Actions jobs logs endpoint. Webhook payloads are used for feedback text, never as the sole source of truth for check status.

Local delivery during development: ngrok with a free static domain (installed and configured on this machine): `ngrok http --url=<name>.ngrok-free.app 3000`, one stable URL for the App. Alternatives for the README: smee.io (`smee-client@5`, re-serialises JSON so confirm signatures still verify), `gh webhook forward` (temporary repository webhooks without `installation`, fine for quick check_run experiments), cloudflared (random URL unless you own a zone).

## Event stream

Event types: `run.created|started|finished|failed|cancelled`, `node.created|claimed|waiting|woken|passed|failed|repaired|interrupted|reclaimed`, `edge.taken|exhausted`, `join.arrived|fired`, `contract.checked` (one per check), `github.webhook`, `human.asked|answered`, `approval.held`, `plan.status|skipped`, `run.scheduled`, `run.overlap_held`, and the `cli.*` family.

`run.created` carries `startedBy` when the starter is known: `dashboard`, `claude-code`, `assistant`, `webmcp`, `cli` or `scheduler`. The same value is in `runs.started_by`.

`approval.held { message, approvedAt, approvedBy?, base, fingerprint }` records that a code review, or a gate that approves code, kept its last approval instead of reviewing or asking again, because the run's own change is the same as when it was approved and at most the base branch was merged in since.

`run.scheduled { place, settings }` is the first event after `run.created` on a run the scheduler started. `place` is the task's place in the scheduler's order at that check (1 for the first candidate), and `settings` holds `maxRuns`, `order`, `graphName` and `skipLabel` as they were then. `run.overlap_held { nodeKey, runId, paths }` records that a run the scheduler started waits before its coder's first attempt, because its plan's owned paths overlap those of the active run `runId`; `paths` are the shared paths.

`plan.status { issue, status }` records a Status written on the project's GitHub Project for a linked task: Running when the run starts, In review when the PR node opens the pull request, Done after the merge closes the issue, Ready when the task's latest run is cancelled. `plan.skipped { issue, status, reason }` records a write that did not happen; the run carries on. `reason` is `not-in-project` (the issue is not an item of the Project), `no-option` (the Project's Status field has no option with that name), `no-access` (no classic `GITHUB_TOKEN` with the `project` scope), or the message of the error GitHub returned. A project without a plan gets neither event.

Scheduler events belong to a project, not a run, so they live in their own table, `scheduler_events` (project id, type, payload, time), and never reach a run's event stream. `by` is who acted (`dashboard`, `claude-code`, `assistant` or the like, or `scheduler` for the scheduler itself).

- `scheduler.started { by, settings }` when a person turns the scheduler on, the first time or after it was off.
- `scheduler.resumed { by }` after a pause, and `scheduler.changed { by, from, to }` when the settings change.
- `scheduler.paused { by, reason? }` when a person pauses it, or `{ by: "scheduler", reason }` when it pauses itself after three failed checks in a row; that pause also sends a notification.
- `scheduler.stopped { by }` when a person turns it off.
- `scheduler.held { holds }` when the project becomes held or the set of holds changes. Each hold is `{ kind, runId, nodeKey }` with `kind` `failed` or `loop`, or a `permission` hold that adds `permissionId` and `toolName`.
- `scheduler.idle { reason, runId? }` when the scheduler becomes idle or the reason changes: `planning` (the run `runId` it started has no plan yet), `no_ready` or `all_skipped`.
- `scheduler.run_started { runId, issue, place }` for each run it starts.
- `scheduler.skipped { issue, reason }` for a Ready task it passes over, written when the reason differs from the last one recorded for that issue.
- `scheduler.start_failed { error }` for each check that failed for a reason other than one task's refusal.
- `scheduler.released { issue, runId, by }` when a person lets the scheduler take a task whose run `runId` they cancelled.

SSE route (`api/runs/[runId]/events/route.ts`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`): cursor from `Last-Event-ID`, else `?after=`, else 0; loop while the request signal is open: `select ... where run_id = $1 and seq > $cursor order by seq limit 500`, write `id: <seq>\nevent: <type>\ndata: <json>\n\n`, sleep 750 ms when empty, `: ping` every 15 s, stop when the run is terminal and drained. Browsers resend `Last-Event-ID` on reconnect.

Polling, not LISTEN/NOTIFY, for v1: a route handler on a pool cannot hold a dedicated LISTEN connection cleanly across dev hot reload, NOTIFY payloads cap at 8000 bytes so a query is still needed, and the tail query is an index range scan. Upgrade path later: one `LISTEN` connection per dashboard process and `NOTIFY handoff_wake` from wake ops, polls kept as fallback. No schema change needed.

## Tooling bootstrap (milestone 0 detail)

1. `pnpm-workspace.yaml`, root `package.json` (private, `packageManager: pnpm@12.6.0`, engines node >= 24), exact version pins everywhere.
2. `tsconfig.base.json`: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, isolatedModules, module NodeNext, target ES2023, skipLibCheck. `apps/web` overrides module ESNext, moduleResolution Bundler, jsx preserve, Next plugin.
3. Root `vitest.config.ts` with projects: `unit` (`packages/**/src/**/*.test.ts`, `apps/worker/src/**/*.test.ts`, node), `integration` (`**/*.integration.test.ts`, node, `fileParallelism: false`, globalSetup migrates `handoff_test`, testTimeout 30 s), `web` (extends `apps/web/vitest.config.ts`, jsdom, `apps/web/src/**/*.test.tsx`, testing-library). Route handler tests are `*.integration.test.ts` in the integration project. Confirm project and extends semantics for Vitest 5 through Context7.
4. `docker-compose.yml`: `postgres:17-alpine`, port 5433:5432, user and password `handoff`, volume `pgdata`, `scripts/db-init.sql` mounted at `/docker-entrypoint-initdb.d/` creating `handoff` and `handoff_test`, healthcheck `pg_isready`.
5. Drizzle config: dialect postgresql, schema `./src/schema/index.ts`, out `./drizzle`, `strict: true`. Workflow: edit schema, `db:generate`, review SQL, `db:migrate`. Tests migrate programmatically.
6. Env: one root `.env` (gitignored), loaded with `node --env-file=.env` for the worker and a symlink `apps/web/.env.local -> ../../.env` for Next. Each app validates with a Zod `EnvSchema` and exits naming missing keys. `.env.example`:

```
DATABASE_URL=postgres://handoff:handoff@localhost:5433/handoff
TEST_DATABASE_URL=postgres://handoff:handoff@localhost:5433/handoff_test
HANDOFF_HOME=./.handoff
HANDOFF_CLAUDE_BIN=claude
HANDOFF_CLAUDE_VERSION=2.1.285
HANDOFF_ALLOW_CLI_DRIFT=
HANDOFF_CAP_CLI=1
HANDOFF_CAP_SHELL=4
HANDOFF_CAP_GITHUB=4
HANDOFF_CAP_FUNCTION=8
HANDOFF_WORKER_ID=
HANDOFF_WORKSPACE=worktree
CLAUDE_CODE_OAUTH_TOKEN=
MCP_TIMEOUT=30000
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=./.handoff/github-app.pem
GITHUB_WEBHOOK_SECRET=
WEB_PORT=3000
NGROK_URL=
```

7. Root scripts: `dev:web`, `dev:worker` (tsx watch), `dev:tunnel`, `handoff` (worker CLI), `db:up|down|reset|generate|migrate|studio`, `test`, `test:unit`, `test:int`, `test:web`, `test:watch`, `typecheck` (`pnpm -r --parallel exec tsc --noEmit`), `lint` (eslint flat config, typescript-eslint, react-hooks in web), `doctor:react` (`npx react-doctor@latest apps/web`).
8. `.github/workflows/ci.yml`: postgres service on 5432 with both databases, pnpm install, typecheck, lint, `pnpm test` with `TEST_DATABASE_URL` pointing at the service and `HANDOFF_CLAUDE_BIN` at the fake binary.
9. ADRs under `docs/adr/`: 0001 custom engine over LangGraph and ADK, 0002 Postgres as queue and event log, 0003 Claude CLI subprocess not the Agent SDK (and why never `--bare`), 0004 graphology export as canonical graph, 0005 pnpm workspace layout.

## Milestones

Each milestone: one GitHub issue, one branch, one PR, CI green, definition of done met. Work the "first tests" list top to bottom, one red-green slice each.

### M0: bootstrap

Goal: `pnpm install && pnpm db:up && pnpm test` green, `pnpm typecheck` and `pnpm lint` pass, CI green, ADRs written, `CLAUDE.md` Commands section filled in.

Files: everything in the bootstrap section, empty `src/index.ts` per package, `apps/web` scaffolded with `create-next-app` (`--ts --app --src-dir --no-tailwind --eslint --use-pnpm --skip-install`, boilerplate removed), `packages/db` with the first migration for github_installations, projects, graphs, graph_versions, runs, node_executions, edge_traversals, events, webhook_deliveries, workers.

First tests: `packages/db/src/migrate.integration.test.ts` "migrations apply to an empty database and are idempotent"; `apps/web/src/app/page.test.tsx` "home page links to runs".

Also: first commit on main with the existing bootstrap files, then the M0 branch. Create the seven milestone issues with `gh issue create` before opening the M0 PR.

### M1: linear run from the CLI, dashboard shows the event stream

Goal: `pnpm handoff run --project <name> --graph linear --task "..."` executes Planner, Coder, PR, Merge against the throwaway sample repo, the PR node waits on a real webhook, and `http://localhost:3000/runs/<id>` shows events live. No editor, no loops.

Slices and first tests:

1a. Graph compile (core). `graph/compile.test.ts`: "compileGraph accepts the linear fixture and exposes nodes in topological order"; "compileGraph rejects a node whose type is not in the catalog"; "compileGraph rejects an edge whose source or target does not exist"; "compileGraph rejects a graph with no start node"; "compileGraph rejects a node unreachable from the start node"; "compileGraph rejects a cycle that contains a non-loop edge"; "compileGraph rejects a loop edge without maxAttempts"; "compileGraph rejects an unknown contract name". `conditions/evaluate.test.ts`: one test per operator plus "evaluateCondition routes CI failure back to the Coder node". Files: `schema/*.ts`, `conditions/*.ts`, `graph/compile.ts`, `graph/catalog.ts`, `graph/routing.ts`, `fixtures/linear.graph.json`.

1b. CLI adapter. `claude/argv.test.ts`: "buildClaudeArgv never emits --bare"; "buildClaudeArgv includes stream-json, json-schema, acceptEdits, permission-prompts none, strict-mcp-config and disableAllHooks"; "buildClaudeArgv passes --resume instead of --name when resumeSessionId is set". `stream-json/parser.test.ts`: "parser reassembles a line split across two chunks"; "parser passes non-JSON stdout through as raw and stderr as stderr events"; "parser passes unknown event types through". `claude/executor.test.ts` (spawns the fake binary, no DB): "executor returns session id, usage and the validated contract output from the result line"; "executor reports error_structured_output when the output does not match the contract"; "executor reports interrupted when the child exits 143 after abort"; "executor spawns with CLAUDE_CONFIG_DIR set and without ANTHROPIC_API_KEY"; "executor writes the context packet file and passes it with --append-system-prompt-file"; "executor sends the prompt on stdin". Files: `types.ts`, `claude/*.ts`, `stream-json/*.ts`, `events.ts`, `testing/*`.

1c. Scheduler and node lifecycle (db and engine, real Postgres). `db/src/ops/claim.integration.test.ts`: "claimNext hands one pending node execution to exactly one of two concurrent workers"; "claimNext respects the cli concurrency cap across workers"; "claimNext does not return a waiting execution before runnable_at". `engine/src/scheduler.integration.test.ts`: "a queued run creates a pending execution for the start node"; "a passed execution creates a pending execution for the next node with the run state merged"; "a failed execution with no failed edge marks the run failed and creates no successor"; "wakeByKey makes a waiting execution claimable now"; "a wake that arrives while the execution is running returns it to pending on yield"; "a running execution whose lease expires is reclaimed and re-run" (ManualClock); "a reclaimed execution is failed on the second reclaim". `engine/src/contract/validate.test.ts`: "validateContract rejects output that fails the contract schema"; "diff_within_paths fails when the diff touches a path outside owned paths" (temp git repo); "tests_green runs the command in the workdir and passes on exit 0". `engine/src/executors/coder.integration.test.ts` (FakeCliExecutor): "Coder node passes with status done and records the session id"; "Coder node with status needs_input passes the contract without checks" (routing to a gate is M2). `workdir/git-worktree.integration.test.ts` (temp bare repo): "GitWorktreeProvider creates a worktree on a new branch from the default branch"; "release removes the worktree and keeps the branch". Files: `worker.ts`, `scheduler/*`, `routing/route.ts`, `contract/*`, `context/select.ts`, `executors/{planner,coder,node-executor}.ts`, `workdir/*`, `db/src/ops/*`.

1d. GitHub adapter and PR and Merge executors. `github/src/verify-signature.test.ts`: "verifyGitHubSignature accepts a body signed with the secret"; "rejects a tampered body"; "rejects a missing or malformed header without throwing". `webhook-events.test.ts` with recorded fixtures: "normaliseWebhook maps a failed check_suite to ci failure"; "normaliseWebhook maps a changes-requested review to feedback with comments"; "correlationKeys derives gh:pr keys from a check_run payload's pull_requests". `engine/src/executors/pr.integration.test.ts` (FakeGitHub): "PR node pushes the branch, opens a PR and yields waiting on its correlation key"; "PR node resumed with checks success passes with PrOutput"; "PR node resumed with checks failure fails with feedback in run state"; "PR node is idempotent when a PR already exists for the branch". `merge.integration.test.ts`: "Merge node merges the PR and passes". Confirm Octokit 5 App auth through Context7.

1e. Worker binary, operator CLI, webhook route, SSE route, run page. `api/webhooks/github/route.integration.test.ts`: "returns 401 for a bad signature and stores nothing"; "stores a delivery once and returns 200 on redelivery"; "wakes the waiting execution whose wait_key matches"; "answers ping with 200". `api/runs/[runId]/events/route.integration.test.ts`: "streams rows after Last-Event-ID as SSE with id fields" (read two events then abort). `components/event-stream.test.tsx`: "event stream renders new events as they arrive" (stubbed EventSource). `apps/worker/src/cli.test.ts`: "handoff run inserts a queued run and prints its id". `db/src/ops/events.integration.test.ts`: "appendEvents allocates gap-free per-run sequence numbers under concurrency". Run react-doctor after this slice.

Done when: with the real `claude` binary and the real GitHub App on the throwaway repo, `pnpm handoff run ...` produces a merged PR; the run page shows CLI and engine events in order; `pnpm test` is green with the fake binary and FakeGitHub; `git worktree list` in the base clone is clean after the run.

### M2: loop edges, bounded retries, repair, human gates, Reviewer and Tester

Goal: Planner, Coder, Tester, Reviewer, PR, Merge with loop edges (Tester fail to Coder, PR feedback to Coder, Reviewer request_changes to Coder), `maxAttempts` guards with `onExhausted` gates, `needs_input` to Human gate and resume of the same session, fan-in joins, and `handoff run repair`.

First tests: `core/graph/routing.test.ts`: "nextEdges picks the conditional edge whose condition matches run state"; "nextEdges falls back to the unconditioned edge"; "nextEdges takes every matching edge for fan-out"; "compileGraph accepts a cycle only through an edge flagged loop with maxAttempts"; "compileGraph requires a gate for an exhausted loop edge". `engine/routing/*.integration.test.ts`: "a loop edge creates attempt 2 of the target node with the failure feedback in its context"; "a loop edge stops after maxAttempts and routes to the Human gate"; "a fan-in node runs once after all upstream nodes pass"; "repairing a failed node re-runs it in place and keeps upstream results"; "a passed repair marks the earlier execution repaired". `executors/human-gate.integration.test.ts`: "Human gate stores a question and yields waiting on its token"; "answering the question wakes the gate and its answer lands in run state"; "answering twice returns 409". `executors/coder.integration.test.ts` additions: "Coder resumed after a needs_input answer passes --resume with the recorded session id and the answer in the prompt" (fake fixture `resume.jsonl`). `executors/tester.integration.test.ts`: "Tester runs the command in the workdir and records exit code and tail". `executors/reviewer.integration.test.ts`: "Reviewer node is spawned with read-only allowed tools". `cli.test.ts` additions for `handoff answer <questionId> "text"`, `handoff run repair <runId> --node <key>`, `handoff run cancel <runId>` ("cancel aborts the running CLI and marks executions failed"). Minimal `POST /api/questions/[id]/answer`.

Files: `routing/{join,loop-guard}.ts`, `executors/{tester,reviewer,human-gate}.ts`, `db/src/schema/questions.ts` and migration, `db/src/ops/repair.ts`, `fixtures/loop.graph.json`.

Done: a run whose Tester fails once loops back to the Coder with the failing tail in the packet and passes on attempt 2; a run that asks a question waits, is answered from the CLI, and finishes; a loop with `maxAttempts: 2` stops at the gate; cancel leaves no orphan process.

### M3: skill and MCP library

Goal: per-node library entries; the engine materialises enabled skills into `<staging>/.claude/skills/<name>/SKILL.md` and passes `--add-dir <staging>`; MCP servers written to `<staging>/mcp.json` with `${secret:NAME}` resolved from the engine environment; `mcp__<server>__*` (or the entry's allowlist) added to `--allowedTools`; edge overrides add or remove entries on a loop edge; the target repo's own `.claude/skills` load only when the node opts in. Staging is deleted after the execution.

First tests: `engine/library/materialize.integration.test.ts`: "enabled skills are written as SKILL.md under the staging dir and passed with --add-dir"; "mcp.json resolves secrets from the engine environment and never from the database"; "an mcp server with a missing secret fails the execution before spawning"; "a loop edge override adds the triage skill only on retry"; "staging is removed after the execution". `core`: "NodeAttributesSchema accepts library.skills and library.mcp"; "EdgeAttributesSchema accepts overrides"; "graph JSON containing a value that looks like a token is rejected". Web: `GET/POST /api/library/skills` and `/mcp`, minimal list and edit pages, tested through the routes.

Done: a Coder run with an enabled skill shows it in the `system/init` event's loaded skills; the MCP server appears in `mcp_servers` with status connected; `mcp_server_errors` non-empty fails the execution.

### M4: React Flow graph editor

Goal: edit graphs in the dashboard. graphology is the model, React Flow is the view. The editor holds one graphology instance; React Flow nodes and edges derive through `toReactFlow`; every change goes through `fromReactFlow` back into graphology before save.

First tests: `core/graph/react-flow.test.ts`: "toReactFlow maps node attributes to node data and x/y to position"; "fromReactFlow(toReactFlow(g)) round-trips the linear and loop fixtures"; "fromReactFlow keeps loop flag and maxAttempts on edges"; "a dragged position updates only x/y". Web: `graph-editor.test.tsx` "adding a Coder node from the palette makes it appear in the saved document"; "connecting two nodes creates an edge with no condition"; "a loop edge renders dashed"; node inspector shows prompt, contract, allowed tools, skill and MCP multi-selects. `api/graphs/[graphId]/route.integration.test.ts`: "PUT validates with GraphDocumentSchema and compileGraph and rejects a graph that does not compile with the compile errors"; "PUT saves a new graph version and leaves in-flight runs pinned". Follow the react-flow skill: stable `nodeTypes`, CSS import in the layout, `ReactFlowProvider` boundary. Context7 for @xyflow/react 12. Live validation in the editor reuses `compileGraph` (unreachable nodes, cycles on non-loop edges, loop edges without maxAttempts, joins without a mode). Run react-doctor.

Done: both fixtures can be imported, edited, saved as a new version, and a run started from the editor page; the run page shows the same graph coloured by execution status.

### M5: inbox

Goal: `/inbox` lists waiting human gates, needs_input questions and exhausted loops across all runs; answering resumes the run; exhausted loops can be retried or cancelled from the inbox.

First tests: "GET /api/inbox lists unanswered questions with run and node context"; "answering a question from the inbox removes it and the run continues" (route plus scheduler); "retrying an exhausted loop from the inbox creates the next attempt"; "cancelling from the inbox marks the run cancelled". Add `handoff gc` to remove CLI transcripts under `claude-config` for finished runs older than N days. Run react-doctor.

Done: an operator drives a whole run's human decisions from the dashboard without the CLI.

### M6: Docker isolation

Goal: `DockerWorkdirProvider` implementing `WorkdirProvider`: one container per run from a configurable image, repo worktree mounted, `spawn` becomes `docker exec`, the `claude` binary runs inside the container with `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN` as env, staging dir bind-mounted, network allowlist following Anthropic's devcontainer reference.

First tests (guarded by `HANDOFF_TEST_DOCKER=1`): "DockerWorkdirProvider runs a command inside the container and reads its output"; "release removes the container"; the executor tests run unchanged against both providers via a parameterised describe.

Done: `HANDOFF_WORKSPACE=docker` runs the M1 end-to-end flow inside a container.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `--bare` becomes the default for `-p`; subscription auth silently stops | Argv unit test asserts `--bare` absent forever. Worker pins `HANDOFF_CLAUDE_VERSION` and refuses drift. `authentication_failed` in `api_retry` fails the execution with a clear message. When bumping the pin, read the CLI changelog and look for an explicit opt-out flag; add it in `buildClaudeArgv` only. |
| Shared subscription rate limit across parallel Coders | `HANDOFF_CAP_CLI=1` enforced under the claim advisory lock. Rate-limit results are retryable with backoff, not permanent failures. |
| Webhook delivery locally | ngrok static domain. Waiting executions carry a 10 min reconcile deadline and re-read PR state on wake, so a missed delivery delays rather than hangs. `webhook_deliveries` dedupes. |
| Resumed session keeps its first system prompt | Answers and retry feedback go in the prompt on `--resume`. Loop retries start a fresh session unless `resumeOnRetry`. |
| `acceptEdits` still denies shell commands outside the read-only set | Catalog gives explicit `--allowedTools` per node type (Coder: Read, Edit, Write, Glob, Grep, `Bash(git *)`, `Bash(pnpm *)`, `Bash(npm *)`, `Bash(npx *)` and the read-only shell commands every CLI node gets, such as `Bash(cat *)`, `Bash(sort -n)` and `Bash(uniq -c)`, plus project additions). `permission_denials` on the result are recorded as an event and shown in the dashboard. |
| Worker crash leaves running rows and orphan `claude` processes | Heartbeat at leaseMs/3, reaper at 30 s, process group kill on abort, `child.pid` files cleaned at startup. |
| `--mcp-config` blocks `-p` up to 30 s or a server fails silently | Set `MCP_TIMEOUT`; read `mcp_servers` and `mcp_server_errors` from `system/init`; fail the execution if a required server is missing. |
| Drizzle 1.0 RC instability | Builder-only code, no `db.query`; downgrade is a version bump plus regenerating migrations once. |
| Test DB pollution | Separate `handoff_test`, truncate between tests, `fileParallelism: false` for integration. Upgrade path: template database cloned per file. |
| Secrets leaking into graph JSON or the database | Library templates store `${secret:NAME}` references only; a schema test rejects token-shaped values in graph JSON; materialisation reads `process.env`. |
| React Flow state diverging from graphology | Single graphology instance in the editor store; round-trip test guards the mapping. |
| CLI flag names drift between versions; `--resume` with `--name` may be rejected | Argv builder passes only one of them; Context7 check of the CLI reference before bumping the pin. |
| Worktrees live on the worker host | Multi-host workers need the Docker provider (M6) before they can reclaim each other's Coder executions; single host until then. |

## Verification

Tests and checks:

```bash
pnpm db:up
pnpm test
pnpm test:unit
pnpm test:int
pnpm test:web
pnpm typecheck && pnpm lint
pnpm doctor:react
```

Run locally:

```bash
cp .env.example .env    # CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, GitHub App values
pnpm db:migrate
pnpm dev:web            # http://localhost:3000
pnpm dev:tunnel         # ngrok static domain to :3000; App webhook URL https://<domain>/api/webhooks/github
pnpm dev:worker
```

First end-to-end run (M1 definition of done):
1. Create a throwaway GitHub repo with a trivial CI workflow (a job that runs `node -e 0`).
2. Create a GitHub App with the permissions and events listed above, install it on the throwaway repo, save the PEM to `.handoff/github-app.pem`, set the webhook secret and the ngrok URL.
3. `pnpm handoff project add --name scratch --repo <owner>/<repo>` (clones into `.handoff/repos/<owner>/<repo>` with an installation token, stores repo_id and installation_id).
4. `pnpm handoff graph import --project scratch --name linear packages/core/src/fixtures/linear.graph.json`.
5. `pnpm handoff run --project scratch --graph linear --task "Add a CHANGELOG.md with today's date" --follow`.
6. Watch `http://localhost:3000/runs/<id>`: expect `run.started`, `node.claimed planner`, `cli.system.init`, `cli.assistant` lines, `cli.result.success`, `node.passed`, the same for coder, `node.waiting` on the PR key, `github.webhook check_suite`, `node.passed pr`, `node.passed merge`, `run.finished`.
7. Confirm on GitHub that the PR merged and locally that `git -C .handoff/repos/<owner>/<repo> worktree list` shows no leftover worktree.

Later milestones verify the same way with their own definition of done, and every PR must show CI green before merge.
