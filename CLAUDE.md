# handoff

Graph-engineering orchestrator for coding agents. A Next.js dashboard with a React Flow editor, a separate worker process that runs the graph engine over Postgres, the Claude Code CLI spawned per Coder node on the user's subscription, and a GitHub App behind the PR node.

## Working rules

- Test first. Every behaviour change starts with a failing test at an agreed seam, then the smallest implementation that passes, then refactor. Follow `.claude/skills/tdd`. Do not write implementation code before its test exists.
- Seams under test: the engine (graph compile from graphology JSON, scheduler, edge routing, loop guards, contract validation), the CLI adapter (stream-json parsing, result validation, driven by a fake `claude` binary), the GitHub adapter (webhook signature verification, PR and check state), API route handlers, and the graphology to React Flow mapping. UI components are tested through behaviour, not snapshots.
- Vitest runs unit and integration tests. Integration tests use a real Postgres started with docker compose, never a mocked database. External processes (the `claude` CLI, GitHub) are replaced by fakes at the adapter boundary only.
- Never pass `--bare` to the Claude CLI. Bare mode does not read the subscription login (see https://code.claude.com/docs/en/headless). Isolate a Coder run with a clean `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, `--settings '{"disableAllHooks":true}'`, `--strict-mcp-config` and an explicit `--allowedTools` list.
- Look up current library docs through the Context7 MCP (`resolve-library-id`, then `query-docs`) before writing code against Next.js, React Flow, Drizzle, Vitest, Octokit, graphology, Zod or the Claude Code CLI. Do not rely on remembered APIs; these libraries change often.
- After changing React or Next.js code, run `npx react-doctor@latest` and fix what it reports before moving on. Treat its findings like failing tests.
- Secrets never live in graph JSON or in the database. The engine resolves them from its environment when it materializes a node's MCP config.

## Stack

pnpm, TypeScript strict, Next.js App Router, shadcn/ui on Tailwind CSS for all dashboard UI, Drizzle ORM on Postgres, graphology, @xyflow/react, Octokit, Zod, Vitest.

## Installed skills

`.claude/skills` holds tdd, vitest, react-flow, github-webhooks, drizzle-best-practices, frontend-design, webapp-testing, vercel-react-best-practices, vercel-composition-patterns, web-design-guidelines, shadcn and setup-matt-pocock-skills, installed with `npx skills add` and pinned in `skills-lock.json`. Use the matching skill when working in that area.

## Implementation plan

`docs/plan.md` is the approved plan: verified facts, repo layout, data model, engine behaviour, milestones with their first tests, risks and verification. Read it before starting any milestone. Milestones are GitHub issues, one branch and PR each.

## Commands

```bash
pnpm install
pnpm db:up          # Postgres 17 on localhost:5433 with databases handoff and handoff_test
pnpm test           # all Vitest projects: unit, integration (needs db:up), web
pnpm test:unit
pnpm test:int
pnpm test:web
pnpm typecheck
pnpm lint
pnpm doctor:react   # after any change under apps/web
pnpm db:generate    # after a schema change; review the SQL, commit it. Never drizzle-kit push.
pnpm db:migrate
pnpm dev:web
```

Test files: `*.test.ts` unit, `*.integration.test.ts` real Postgres or subprocesses, `*.test.tsx` web components.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Krister-Johansson/handoff, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.
