import type { ZodType, core } from "zod";

export type CliSession = { mode: "new"; id: string; name: string } | { mode: "resume"; id: string };

export type CliRunRequest = {
  /** Short instruction for this turn. On resume this carries answers and retry feedback. */
  prompt: string;
  /** Context packet markdown; written to `<stagingDir>/context.md` and appended to the system prompt. */
  systemPrompt: string;
  cwd: string;
  stagingDir: string;
  allowedTools: string[];
  maxTurns: number;
  contract: ZodType;
  mcpConfigPath?: string;
  addDirs: string[];
  session: CliSession;
  timeoutMs: number;
  /** Fails the run if no stdout line arrives for this long. */
  idleTimeoutMs?: number;
  model?: string;
};

export type CliEvent = { type: string; payload: unknown };

export type CliOutcome = "success" | "error_max_turns" | "error_structured_output" | "error" | "interrupted" | "timeout";

export type CliRunResult = {
  outcome: CliOutcome;
  sessionId?: string;
  structuredOutput?: unknown;
  validated?: unknown;
  validationIssues?: core.$ZodIssue[];
  costUsd?: number;
  usage?: unknown;
  numTurns?: number;
  permissionDenials?: unknown[];
  exitCode: number | null;
  signal?: string;
  stderrTail: string;
  errorMessage?: string;
};

export type CliRunOptions = {
  signal: AbortSignal;
  onEvent: (event: CliEvent) => void | Promise<void>;
  /** Called once with the session id as soon as a stream line carries it (normally system/init). */
  onSessionId?: (id: string) => void | Promise<void>;
};

/** Runs one agent turn in a working directory. The Claude CLI implementation is the only one today. */
export interface CliExecutor {
  run(request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult>;
}
