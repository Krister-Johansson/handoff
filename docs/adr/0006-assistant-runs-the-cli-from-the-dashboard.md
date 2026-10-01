# 6. The assistant runs the Claude Code CLI from the dashboard

Date: 2026-10-01. Status: accepted.

## Decision

The dashboard's assistant answers each turn by spawning the unmodified Claude Code CLI (`claude -p`) from the dashboard process, with the operator's `CLAUDE_CODE_OAUTH_TOKEN`, on the same basis as ADR 0003. It never uses the Agent SDK or an API key. A turn streams `stream-json` with partial messages, loads no built-in tools (`--tools ""`), and reaches handoff only through a per-turn MCP endpoint on the dashboard, `/api/assistant/mcp`, which accepts that turn's random token and nothing else. Tools that only read are in `--allowedTools`. Every other tool goes through `--permission-prompt-tool mcp__handoff__approve`, whose handler shows the person an approval card and waits. A later turn resumes the conversation's CLI session with `--resume`.

`apps/web` may therefore depend on `@handoff/cli-adapter`, which amends the dependency direction in ADR 0005 to `web -> core, db, github, engine, cli-adapter`. `cli-adapter` still never imports `db`.

## Consequences

- Streaming and approvals stay in one process: token deltas reach the browser over a server-sent event stream without passing through the events table, and an approval is an in-memory promise resolved by the person's click.
- The assistant shares the subscription with Coder nodes, and the worker's CLI cap does not count it. One turn per conversation and `--max-turns` keep it small.
- Turns live in memory: restarting the dashboard ends running turns. Conversations and messages are stored in `assistant_conversations` and `assistant_messages`, with no secret or token.
- A worker-hosted or API-key runner can be added behind the same `ChatRunnerLike` interface later, for example to distribute handoff to other users.
