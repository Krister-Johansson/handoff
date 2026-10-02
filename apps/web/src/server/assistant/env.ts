import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** How the dashboard runs its assistant. Without an OAuth token the assistant is unavailable. */
export type AssistantConfig = {
  oauthToken: string | undefined;
  /** Where the assistant keeps its Claude Code config, working folder and per-turn staging folders. */
  home: string;
  claudeBin: string;
  model: string;
  effort: string;
  maxTurns: number;
  /** How long an approval card waits for the person before the call is denied. */
  approvalTimeoutMs: number;
  /** How long a UI tool call waits for the page to answer. */
  uiTimeoutMs: number;
  /** How long one turn may run before it is stopped. */
  turnTimeoutMs: number;
};

const number = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/** The assistant's configuration from the dashboard's environment, with the plan's defaults. */
export function assistantConfig(env: Record<string, string | undefined> = process.env): AssistantConfig {
  const base = env.HANDOFF_HOME ? resolve(env.HANDOFF_HOME) : join(homedir(), ".handoff");
  return {
    oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN || undefined,
    home: join(base, "assistant"),
    claudeBin: env.HANDOFF_CLAUDE_BIN || "claude",
    model: env.HANDOFF_ASSISTANT_MODEL || "sonnet",
    effort: env.HANDOFF_ASSISTANT_EFFORT || "low",
    maxTurns: number(env.HANDOFF_ASSISTANT_MAX_TURNS, 12),
    approvalTimeoutMs: number(env.HANDOFF_ASSISTANT_APPROVAL_TIMEOUT_MS, 5 * 60_000),
    uiTimeoutMs: 30_000,
    turnTimeoutMs: number(env.HANDOFF_ASSISTANT_TURN_TIMEOUT_MS, 15 * 60_000),
  };
}
