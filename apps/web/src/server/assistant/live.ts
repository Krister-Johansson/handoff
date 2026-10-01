import { join } from "node:path";
import { ClaudeChatRunner } from "@handoff/cli-adapter";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { assistantConfig } from "./env";
import type { TurnDeps } from "./turn";

/** What a turn needs in the running dashboard, or undefined when the assistant is unavailable (no OAuth token). */
export function liveTurnDeps(request: Request): TurnDeps | undefined {
  const config = assistantConfig();
  if (!config.oauthToken) return undefined;
  const runner = new ClaudeChatRunner({ command: { file: config.claudeBin, prefixArgs: [] }, oauthToken: config.oauthToken, configDir: join(config.home, "claude-config") });
  return { db: getDb(), github: getGitHub(), runner, config, baseUrl: new URL(request.url).origin };
}
