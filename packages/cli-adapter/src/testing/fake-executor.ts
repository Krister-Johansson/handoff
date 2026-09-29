import type { CliExecutor, CliRunOptions, CliRunRequest, CliRunResult } from "../types.ts";

export type FakeReply =
  | { output: unknown; events?: { type: string; payload: unknown }[]; costUsd?: number }
  | { result: Partial<CliRunResult> & Pick<CliRunResult, "outcome"> }
  | ((request: CliRunRequest, options: CliRunOptions) => Promise<CliRunResult>);

/** In-memory CliExecutor for engine tests. Replies are consumed in order per session name prefix or globally. */
export class FakeCliExecutor implements CliExecutor {
  readonly requests: CliRunRequest[] = [];
  private readonly queue: FakeReply[];

  constructor(replies: FakeReply[] = []) {
    this.queue = [...replies];
  }

  push(...replies: FakeReply[]) {
    this.queue.push(...replies);
  }

  async run(request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> {
    this.requests.push(request);
    const reply = this.queue.shift();
    if (!reply) throw new Error(`FakeCliExecutor has no reply for request ${this.requests.length}`);
    if (typeof reply === "function") return reply(request, options);
    await options.onSessionId?.(request.session.id);
    if ("result" in reply) return { exitCode: 1, stderrTail: "", sessionId: request.session.id, ...reply.result };
    for (const event of reply.events ?? [{ type: "cli.system.init", payload: { session_id: request.session.id } }]) {
      await options.onEvent(event);
    }
    const parsed = request.contract.safeParse(reply.output);
    if (!parsed.success) {
      return { outcome: "error_structured_output", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: reply.output, validationIssues: parsed.error.issues };
    }
    return {
      outcome: "success",
      exitCode: 0,
      stderrTail: "",
      sessionId: request.session.id,
      structuredOutput: reply.output,
      validated: parsed.data,
      costUsd: reply.costUsd ?? 0.01,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
}
