import { join } from "node:path";
import { ClaudeChatRunner } from "@handoff/cli-adapter";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { assistantState } from "./settings";
import type { TurnDeps } from "./turn";

/** Why the assistant cannot answer now, for the turns route; undefined when it can. */
export function unavailableMessage(): string | undefined {
  const { reason } = assistantState();
  if (reason === "no-token") return "The assistant needs CLAUDE_CODE_OAUTH_TOKEN in the dashboard's environment.";
  if (reason === "off") return "The assistant is switched off in Settings.";
  return undefined;
}

/** What a turn needs in the running dashboard, or undefined when the assistant is unavailable. */
export function liveTurnDeps(request: Request): TurnDeps | undefined {
  const { config, available } = assistantState();
  if (!available || !config.oauthToken) return undefined;
  const runner = new ClaudeChatRunner({ command: { file: config.claudeBin, prefixArgs: [] }, oauthToken: config.oauthToken, configDir: join(config.home, "claude-config") });
  return { db: getDb(), github: getGitHub(), runner, config, baseUrl: new URL(request.url).origin };
}
