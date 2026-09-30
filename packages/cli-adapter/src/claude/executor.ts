import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { toCliEvent } from "../events.ts";
import { trackDescendants } from "../processes.ts";
import { parseStreamJson, type StreamJsonLine } from "../stream-json/parser.ts";
import type { CliExecutor, CliRunOptions, CliRunRequest, CliRunResult } from "../types.ts";
import { ancestorInstructionExcludes, buildClaudeArgv } from "./argv.ts";
import { buildClaudeEnv } from "./env.ts";

export type ClaudeCliExecutorOptions = {
  /** Production: { file: "claude", prefixArgs: [] }. Tests: node + the fake binary. */
  command: { file: string; prefixArgs: string[] };
  oauthToken: string;
  configDir: string;
  baseEnv?: Record<string, string | undefined>;
  passthroughEnv?: string[];
  /** Delay between SIGINT, SIGTERM and SIGKILL when stopping the child. */
  killGraceMs?: number;
  /** How often to look for processes claude starts, which are stopped when it exits. */
  trackIntervalMs?: number;
};

const STDERR_TAIL_LINES = 50;

export class ClaudeCliExecutor implements CliExecutor {
  constructor(private readonly options: ClaudeCliExecutorOptions) {}

  async run(request: CliRunRequest, { signal, onEvent, onSessionId, onSpawn }: CliRunOptions): Promise<CliRunResult> {
    mkdirSync(request.stagingDir, { recursive: true });
    const systemPromptFile = join(request.stagingDir, "context.md");
    writeFileSync(systemPromptFile, request.systemPrompt);

    const argv = buildClaudeArgv({
      prompt: request.prompt,
      // Draft-07: the Claude CLI's validator rejects the 2020-12 $schema that Zod emits by default.
      jsonSchema: z.toJSONSchema(request.contract, { target: "draft-7" }),
      allowedTools: request.allowedTools,
      maxTurns: request.maxTurns,
      systemPromptFile,
      addDirs: request.addDirs,
      session: request.session,
      claudeMdExcludes: ancestorInstructionExcludes(request.cwd),
      ...(request.mcpConfigPath ? { mcpConfigPath: request.mcpConfigPath } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.effort ? { effort: request.effort } : {}),
      ...(request.agents ? { agents: request.agents } : {}),
    });

    const childEnv = buildClaudeEnv({
      oauthToken: this.options.oauthToken,
      configDir: this.options.configDir,
      base: this.options.baseEnv ?? process.env,
      passthrough: this.options.passthroughEnv ?? [],
    });
    const launch = request.container
      ? dockerExec(request.container, request.cwd, childEnv, [this.options.command.file, ...this.options.command.prefixArgs, ...argv])
      : { file: this.options.command.file, args: [...this.options.command.prefixArgs, ...argv], env: childEnv };
    const child = spawn(launch.file, launch.args, {
      cwd: request.cwd,
      env: launch.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    if (child.pid) await onSpawn?.(child.pid);
    // In a container the processes live there; on the host, watch what claude starts so nothing outlives it.
    const tracker = child.pid && !request.container ? trackDescendants(child.pid, this.options.trackIntervalMs) : undefined;
    const stderrTail: string[] = [];
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    });

    let stopReason: "abort" | "timeout" | "idle" | undefined;
    const timers: NodeJS.Timeout[] = [];
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // already gone
      }
      // docker exec does not forward signals without a TTY; signal the process inside the container too.
      if (request.container) {
        spawn("docker", ["exec", request.container, "pkill", `-${sig.replace("SIG", "")}`, "-f", this.options.command.file], { stdio: "ignore" }).on("error", () => {});
      }
    };
    const stop = (reason: typeof stopReason) => {
      if (stopReason || child.exitCode !== null) return;
      stopReason = reason;
      const grace = this.options.killGraceMs ?? 10_000;
      killGroup("SIGINT");
      timers.push(setTimeout(() => killGroup("SIGTERM"), grace));
      timers.push(setTimeout(() => killGroup("SIGKILL"), grace * 2));
    };
    const onAbort = () => stop("abort");
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    timers.push(setTimeout(() => stop("timeout"), request.timeoutMs));
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = () => {
      if (!request.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop("idle"), request.idleTimeoutMs);
    };
    resetIdle();

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("close", (code, sig) => resolve({ code, signal: sig })),
    );
    const spawnError = new Promise<Error>((resolve) => child.on("error", resolve));

    let sessionId: string | undefined;
    let resultLine: StreamJsonLine | undefined;
    const consume = (async () => {
      for await (const line of parseStreamJson(child.stdout)) {
        resetIdle();
        const lineSession = "session_id" in line ? line.session_id : undefined;
        if (typeof lineSession === "string" && sessionId === undefined) {
          sessionId = lineSession;
          await onSessionId?.(lineSession);
        }
        if (line.type === "result") resultLine = line as StreamJsonLine;
        await onEvent(toCliEvent(line));
      }
    })();

    const first = await Promise.race([exited.then((e) => ({ kind: "exit" as const, e })), spawnError.then((err) => ({ kind: "error" as const, err }))]);
    await consume.catch(() => {});
    const exit = first.kind === "exit" ? first.e : await exited.catch(() => ({ code: null, signal: null }));
    signal.removeEventListener("abort", onAbort);
    for (const t of timers) clearTimeout(t);
    if (idleTimer) clearTimeout(idleTimer);
    await tracker?.stop(this.options.killGraceMs);

    const base: CliRunResult = {
      outcome: "error",
      exitCode: exit.code,
      stderrTail: stderrTail.join("\n"),
      ...(exit.signal ? { signal: exit.signal } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
    if (first.kind === "error") return { ...base, errorMessage: `failed to start claude: ${first.err.message}` };
    if (stopReason === "abort") return { ...base, outcome: "interrupted" };
    if (stopReason === "timeout" || stopReason === "idle") return { ...base, outcome: "timeout", errorMessage: `stopped: ${stopReason}` };
    if (!resultLine) return { ...base, errorMessage: "claude exited without a result line" };
    return interpretResult(base, resultLine, request);
  }
}

function interpretResult(base: CliRunResult, line: StreamJsonLine, request: CliRunRequest): CliRunResult {
  const result: CliRunResult = {
    ...base,
    ...(typeof line.session_id === "string" ? { sessionId: line.session_id } : {}),
    ...(typeof line.total_cost_usd === "number" ? { costUsd: line.total_cost_usd } : {}),
    ...(line.usage !== undefined ? { usage: line.usage } : {}),
    ...(typeof line.num_turns === "number" ? { numTurns: line.num_turns } : {}),
    ...(Array.isArray(line.permission_denials) ? { permissionDenials: line.permission_denials } : {}),
  };
  if (line.subtype === "error_max_turns") return { ...result, outcome: "error_max_turns" };
  if (line.subtype !== "success" || line.is_error === true) {
    return { ...result, outcome: "error", errorMessage: typeof line.result === "string" ? line.result : `result ${line.subtype}` };
  }
  if (line.structured_output === undefined) {
    return { ...result, outcome: "error_structured_output", errorMessage: "result has no structured_output" };
  }
  const parsed = request.contract.safeParse(line.structured_output);
  if (!parsed.success) {
    return { ...result, outcome: "error_structured_output", structuredOutput: line.structured_output, validationIssues: parsed.error.issues };
  }
  return { ...result, outcome: "success", structuredOutput: line.structured_output, validated: parsed.data };
}

/** Host-specific variables that must not be forwarded into the container. */
const HOST_ONLY = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR"]);

/**
 * `docker exec` argv for running claude inside a run's container. Variables are forwarded by name
 * (-e KEY) so their values never appear in the process list.
 */
export function dockerExec(container: string, cwd: string, childEnv: Record<string, string>, command: string[]) {
  const forwarded = Object.keys(childEnv).filter((k) => !HOST_ONLY.has(k));
  return {
    file: "docker",
    args: ["exec", "-i", "-w", cwd, ...forwarded.flatMap((k) => ["-e", k]), container, ...command],
    env: { ...process.env, ...Object.fromEntries(forwarded.map((k) => [k, childEnv[k]!])) },
  };
}
