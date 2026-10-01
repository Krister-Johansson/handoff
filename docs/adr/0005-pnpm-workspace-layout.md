# 5. pnpm workspace with source-only packages

Date: 2026-09-29. Status: accepted.

## Decision

Packages `core`, `db`, `cli-adapter`, `github`, `engine`; apps `worker` and `web`. Packages export `src/index.ts` directly with no build step: Next.js compiles them through `transpilePackages`, the worker runs through `tsx`, Vitest reads TypeScript natively. Package boundaries exist where two runtimes consume the code: the dashboard must import schemas, the graph compiler and signature verification without pulling in `child_process`, git or Octokit.

Dependency direction: `core <- db <- engine`, `core <- cli-adapter <- engine`, `core <- github <- engine`, `engine <- worker`, `web -> core, db, github, engine, cli-adapter` (ADR 0006 adds `cli-adapter` for the assistant).
