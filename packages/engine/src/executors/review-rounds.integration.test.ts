import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, startRun } from "../testing/harness.ts";
import { cliNodeExecutor } from "./cli-node.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** coder -> code review; the review's changes go back to the coder. */
const graph = {
  attributes: { startNode: "coder" },
  nodes: [
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "review", attributes: { type: "code_review", x: 300, y: 0 } },
  ],
  edges: [
    { key: "coder->review", source: "coder", target: "review", attributes: { port: "done" } },
    { key: "review->coder", source: "review", target: "coder", attributes: { port: "changes" } },
  ],
};

test("a code review asks for changes only for blocking findings, and its next round checks its earlier comments", async () => {
  const cli = new FakeCliExecutor([
    { output: { status: "done", summary: "Added the env schema." } },
    { output: { verdict: "request_changes", comments: [{ path: "src/env.ts", line: 5, body: "Only checks the scheme." }] } },
    { output: { status: "done", summary: "Validated the host too." } },
    { output: { verdict: "approve", comments: [] } },
  ]);
  await startRun(db, graph, "Validate the environment");
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  await drain(engineDeps(db, { coder: agent, code_review: agent }));

  const [, firstReview, , secondReview] = cli.requests;
  expect(firstReview!.prompt).toMatch(/request_changes only for a finding that makes the change wrong, insecure, or misses the task/);
  expect(firstReview!.systemPrompt).not.toContain("# Your previous review");
  expect(secondReview!.prompt).toContain("You reviewed this work before");
  expect(secondReview!.systemPrompt).toContain("# Your previous review");
  expect(secondReview!.systemPrompt).toContain("- src/env.ts:5: Only checks the scheme.");
  expect(secondReview!.systemPrompt).toContain("Validated the host too.");
});
