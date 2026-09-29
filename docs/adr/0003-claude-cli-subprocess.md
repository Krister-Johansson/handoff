# 3. Claude Code CLI as a subprocess, never with --bare

Date: 2026-09-29. Status: accepted.

## Decision

Coder-type nodes spawn `claude -p` with `--output-format stream-json --verbose --json-schema ...` and authenticate with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, so usage counts against the operator's own Claude subscription. The Agent SDK is not used because it requires an API key.

`--bare` is never passed: bare mode never reads OAuth credentials, the keychain or `CLAUDE_CODE_OAUTH_TOKEN` (https://code.claude.com/docs/en/headless). Isolation comes instead from a dedicated `CLAUDE_CONFIG_DIR`, `--settings '{"disableAllHooks":true}'`, `--strict-mcp-config`, `--permission-prompts none` and an explicit `--allowedTools` list.

Anthropic permits an end user to sign in to the unmodified binary with their own subscription, including in sandboxes. It does not permit third parties to intermediate claude.ai credentials, so distributing handoff to other users would require an API-key executor.

## Consequences

The CLI sits behind a `CliExecutor` interface so an API-key implementation can be added later. The CLI version is pinned and checked at worker start, because the docs say `--bare` will become the default for `-p` in a future release. A unit test asserts `--bare` is never emitted.
