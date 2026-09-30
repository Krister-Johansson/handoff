import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, startRun } from "../testing/harness.ts";
import { outputs } from "../testing/scripted.ts";
import { cliNodeExecutor } from "./cli-node.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const plan = { plan: "Scaffold the app.", steps: ["Run the CLI"], ownedPaths: ["src/"] };

/** planner -> reviewer -> coder, all three through the CLI adapter. */
const graph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 300, y: 0 } },
    { key: "coder", attributes: { type: "coder", x: 600, y: 0 } },
  ],
  edges: [
    { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done" } },
    { key: "reviewer->planner", source: "reviewer", target: "planner", attributes: { port: "changes" } },
    { key: "reviewer->coder", source: "reviewer", target: "coder", attributes: { port: "approve" } },
  ],
};

async function run(review: unknown) {
  const cli = new FakeCliExecutor([{ output: plan }, { output: review }, { output: outputs.coderDone }]);
  await startRun(db, graph, "Scaffold the app");
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  await drain(engineDeps(db, { planner: agent, reviewer: agent, coder: agent }));
  return cli.requests;
}

test("the reviewer is told to request changes for every finding and to approve only without one", async () => {
  const [, reviewer] = await run({ verdict: "approve", comments: [] });
  expect(reviewer!.prompt).toMatch(/request_changes/);
  expect(reviewer!.prompt).toMatch(/approve only when/i);
});

test("comments that come with an approval reach later steps as suggestions", async () => {
  const [, , coder] = await run({ verdict: "approve", comments: [{ path: "docs/features.md", line: 14, body: "Keep the t3env schema empty." }] });
  expect(coder!.systemPrompt).toContain("# Suggestions from reviewers");
  expect(coder!.systemPrompt).toContain("- docs/features.md:14 - reviewer: Keep the t3env schema empty.");
});

test("an approval without comments adds no suggestions", async () => {
  const [, , coder] = await run({ verdict: "approve", comments: [] });
  expect(coder!.systemPrompt).not.toContain("# Suggestions from reviewers");
});
