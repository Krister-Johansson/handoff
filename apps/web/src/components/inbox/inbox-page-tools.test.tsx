import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { InboxPageTools } from "./inbox-page-tools";
import { InboxSections } from "./inbox-sections";
import type { InboxView } from "./inbox-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/inbox" }));
vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), repairAction: vi.fn(), cancelAction: vi.fn(), resolveLoopAction: vi.fn(), answerPermissionAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => ({ requestMergeAction: vi.fn() }));

const todo = { projectId: "p1", projectName: "todooverkill" };
const asked = new Date("2026-10-01T10:00:00Z");

const view: InboxView = {
  permissions: [{ ...todo, id: "perm-1", runId: "r1", task: "#10 Projects in the sidebar", nodeKey: "coder", toolName: "Bash", input: { command: "git log" }, createdAt: asked }],
  reviews: [{ ...todo, id: "q-review", runId: "r2", task: "#11 Plan", question: "Review the plan from Planner", options: ["approve", "changes"], nodeKey: "gate", reason: "approval", context: { review: { from: "planner", kind: "plan" } }, createdAt: asked }],
  questions: [
    { ...todo, id: "q-ask", runId: "r3", task: "#12 License", question: "Which license?", options: ["MIT", "Apache-2.0"], nodeKey: "coder", reason: "needs_input", context: {}, createdAt: asked },
    { ...todo, id: "q-try", runId: "r4", task: "#13 Todo CRUD", question: "Try the app", options: ["approve", "changes"], nodeKey: "try", reason: "try", context: { reason: "try" }, createdAt: asked },
  ],
  readyToMerge: [{ ...todo, runId: "r5", task: "#14 Test harness", prNumber: 54, issues: [] }],
  failedRuns: [{ ...todo, runId: "r6", task: "#15 Broken", executionId: "x6", nodeKey: "tester", attempt: 2, error: { code: "TESTS_FAILED", message: "2 tests failed\nmore output" }, finishedAt: null }],
  stuckRuns: [{ ...todo, runId: "r7", task: "#16 Looping", nodeKey: "reviewer", loop: "reviewer->coder", attempts: 3, finishedAt: null }],
  pullRequests: [{ ...todo, runId: "r8", task: "#17 Shell", executionId: "x8", number: 61, url: "https://github.com/o/r/pull/61", ci: "success", branch: "handoff/17" }],
};

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/** The Inbox inside the assistant, with a turn running so the test can call the page's tools as the model would. */
async function withAssistant(shown: InboxView, project: { id: string; name: string } | null = null) {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <InboxPageTools view={shown} project={project} />
      <InboxSections view={shown} />
    </AssistantProvider>,
  );
  act(() => void port!.send("what needs me"));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  let next = 1;
  const call = async (name: string, args: unknown = {}) => {
    const requestId = `u${next++}`;
    act(() => transport.emit({ type: "ui_call", requestId, name, args }));
    await waitFor(() => expect(transport.uiReplies.find((r) => r.requestId === requestId)).toBeDefined());
    const { text, isError } = transport.uiReplies.find((r) => r.requestId === requestId)!;
    return { text, isError };
  };
  const whereAmI = async () => JSON.parse((await call("where_am_i")).text) as { page?: { kind: string; tools: { name: string }[]; state: { data: Record<string, unknown> } } };
  return { call, whereAmI, transport };
}

test("where_am_i on the inbox lists the ids of every card by group", async () => {
  const { whereAmI } = await withAssistant(view);
  const page = (await whereAmI()).page!;
  expect(page.kind).toBe("inbox");
  expect(page.tools.map((t) => t.name)).toEqual(["page_show_item"]);
  expect(page.state.data).toEqual({
    project: null,
    permissions: [{ id: "perm-1", runId: "r1", project: "todooverkill", task: "#10 Projects in the sidebar", nodeKey: "coder", tool: "Bash", action: "asks to run a command", detail: "git log" }],
    reviews: [{ id: "q-review", runId: "r2", project: "todooverkill", task: "#11 Plan", question: "Review the plan from Planner" }],
    questions: [
      { id: "q-ask", runId: "r3", project: "todooverkill", task: "#12 License", nodeKey: "coder", reason: "needs_input", question: "Which license?", options: ["MIT", "Apache-2.0"] },
      { id: "q-try", runId: "r4", project: "todooverkill", task: "#13 Todo CRUD", nodeKey: "try", reason: "try", question: "Try the app", options: ["approve", "changes"] },
    ],
    readyToMerge: [{ id: "r5", runId: "r5", project: "todooverkill", task: "#14 Test harness", prNumber: 54 }],
    failedRuns: [{ id: "x6", runId: "r6", project: "todooverkill", task: "#15 Broken", nodeKey: "tester", attempt: 2, error: "TESTS_FAILED: 2 tests failed" }],
    stuckRuns: [{ id: "r7", runId: "r7", project: "todooverkill", task: "#16 Looping", nodeKey: "reviewer", loop: "reviewer->coder", attempts: 3 }],
    pullRequests: [{ id: "x8", runId: "r8", project: "todooverkill", task: "#17 Shell", number: 61, url: "https://github.com/o/r/pull/61" }],
  });

  // Every id where_am_i gives is a card on the page.
  const ids = Object.values(page.state.data).flatMap((group) => (Array.isArray(group) ? group.map((item: { id: string }) => item.id) : []));
  expect(ids).toEqual(["perm-1", "q-review", "q-ask", "q-try", "r5", "x6", "r7", "x8"]);
  for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
});
