import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { mountView, textResult as jsonResult, unmountViews } from "../testing";
import { RUN_CARD_HTML } from "../views.generated";
import { startRunCard } from "./main";

const RUN_URL = "http://localhost:3000/projects/p1/runs/7f3a2c1e-0000-4000-8000-000000000001";

/** get_run's answer for a run whose coder, on its second attempt, waits for a permission. */
const run = {
  id: "7f3a2c1e-0000-4000-8000-000000000001",
  project: "sandbox",
  graph: "linear",
  task: "",
  status: "waiting",
  started_by: "claude-code",
  url: RUN_URL,
  branch: "handoff/55-shaping-tools",
  continues: null,
  superseded_by: null,
  pr: { number: 88, url: "https://github.com/octo/sample/pull/88" },
  issues: [{ number: 55, title: "Shaping tools in the catalog", url: "https://github.com/octo/sample/issues/55" }],
  cost_usd: 0.84,
  steps: [
    { node: "planner", attempt: 1, status: "passed", started_at: "2026-10-03T10:00:00.000Z", finished_at: "2026-10-03T10:02:00.000Z", duration_seconds: 120, cost_usd: 0.2 },
    { node: "plan-review", attempt: 1, status: "passed", started_at: "2026-10-03T10:02:00.000Z", finished_at: "2026-10-03T10:03:00.000Z", duration_seconds: 60, cost_usd: 0.1 },
    { node: "coder", attempt: 1, status: "sent_back", started_at: "2026-10-03T10:03:00.000Z", finished_at: "2026-10-03T10:08:00.000Z", duration_seconds: 300, cost_usd: 0.3 },
    { node: "reviewer", attempt: 1, status: "passed", started_at: "2026-10-03T10:08:00.000Z", finished_at: "2026-10-03T10:09:00.000Z", duration_seconds: 60, cost_usd: 0.04 },
    { node: "coder", attempt: 2, status: "running", state: "waiting", waiting_on: "permission", started_at: "2026-10-03T10:09:00.000Z", finished_at: null, duration_seconds: 300, cost_usd: 0.2 },
  ],
  questions: [],
  permissions: [{ id: "perm1", node: "coder", attempt: 2, tool: "Bash", asks: "asks to run a command", detail: "pnpm test", input: { command: "pnpm test" }, asked_at: "2026-10-03T10:12:00.000Z" }],
  failed: null,
  answered: [],
  stuck: null,
};

const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

let bridge: AppBridge | undefined;
afterEach(async () => {
  // The view reports its size on the next frame; let it, before the host goes.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await bridge?.close();
  bridge = undefined;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
});

/** Mounts the run card as a host would: an AppBridge on one end, the view on the other, then the tool's input and result. */
async function show(result: { content: { type: "text"; text: string }[]; isError?: boolean }, options: { capabilities?: McpUiHostCapabilities; theme?: "light" | "dark" } = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  bridge = new AppBridge(null, { name: "test-host", version: "1.0.0" }, options.capabilities ?? { openLinks: {} }, { hostContext: { theme: options.theme ?? "light" } });
  const opened: string[] = [];
  bridge.onopenlink = async ({ url }) => {
    opened.push(url);
    return {};
  };
  const initialized = new Promise<void>((resolve) => (bridge!.oninitialized = () => resolve()));
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await startRunCard(root, viewSide);
  await initialized;
  await bridge.sendToolInput({ arguments: { run_id: run.id } });
  await bridge.sendToolResult(result);
  return { root, opened };
}

test("the run card shows the run's status, issue, graph, attempt, cost, steps, pull request and what it waits on", async () => {
  await show(textResult(run));
  const card = await screen.findByRole("region", { name: "Run 7f3a2c1e" });
  const view = within(card);
  expect(view.getByText("waiting")).toBeInTheDocument();
  expect(view.getByText("#55")).toBeInTheDocument();
  expect(view.getByText("Shaping tools in the catalog")).toBeInTheDocument();
  expect(view.getByText("linear")).toBeInTheDocument();
  expect(view.getByText("attempt 2")).toBeInTheDocument();
  expect(view.getByText("$0.84 so far")).toBeInTheDocument();
  // One segment per node, the latest attempt of each: coder ran twice and now waits.
  const steps = view.getByRole("list", { name: "Steps, 3 of 4 done" });
  expect(within(steps).getAllByRole("listitem").map((li) => li.getAttribute("title"))).toEqual(["planner, done", "plan-review, done", "coder, waiting, attempt 2", "reviewer, done"]);
  // The permission it waits for is a card of its own, with the whole command.
  expect(within(view.getByRole("article", { name: "coder asks to run a command" })).getByText("pnpm test")).toBeInTheDocument();
  expect(view.getByRole("link", { name: "PR #88" })).toBeInTheDocument();
});

test("Open run asks the host to open the run in the dashboard when the host opens links", async () => {
  const { opened } = await show(textResult(run));
  fireEvent.click(await screen.findByRole("link", { name: "Open run" }));
  await waitFor(() => expect(opened).toEqual([RUN_URL]));
});

test("without the host's openLinks, Open run is a plain link to the dashboard", async () => {
  const { opened } = await show(textResult(run), { capabilities: {} });
  const link = await screen.findByRole("link", { name: "Open run" });
  expect(link).toHaveAttribute("href", RUN_URL);
  expect(link).toHaveAttribute("target", "_blank");
  link.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(link);
  expect(opened).toEqual([]);
});

test("a failed run says where it failed and why, and a finished run's cost is final", async () => {
  await show(
    textResult({
      ...run,
      status: "failed",
      pr: null,
      steps: [{ ...run.steps[0], node: "coder", status: "failed", attempt: 1 }],
      permissions: [],
      failed: { node: "coder", attempt: 1, code: "max_turns", error: "Claude stopped after 40 turns." },
    }),
  );
  const view = within(await screen.findByRole("region", { name: "Run 7f3a2c1e" }));
  expect(view.getByText("Failed at coder: Claude stopped after 40 turns.")).toBeInTheDocument();
  expect(view.getByText("$0.84")).toBeInTheDocument();
  expect(view.queryByRole("link", { name: /^PR/ })).not.toBeInTheDocument();
});

test("a run on a task without issues shows the task as its title", async () => {
  await show(textResult({ ...run, issues: [], task: "Add a CHANGELOG.md" }));
  const view = within(await screen.findByRole("region", { name: "Run 7f3a2c1e" }));
  expect(view.getByText("Add a CHANGELOG.md")).toBeInTheDocument();
});

test("a tool error is shown as the error's text", async () => {
  await show({ content: [{ type: "text", text: "There is no run nope." }], isError: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("There is no run nope.");
});

test("the bundled run card renders a run in an iframe, over postMessage, as a host loads it", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  bridge = new AppBridge(null, { name: "test-host", version: "1.0.0" }, { openLinks: {} }, { hostContext: { theme: "dark" } });
  const initialized = new Promise<void>((resolve) => (bridge!.oninitialized = () => resolve()));
  // jsdom's postMessage leaves event.source empty, and both ends check it, so each message goes with its source,
  // copied into the receiving frame's realm as a browser's structured clone does.
  const view = frame.contentWindow!;
  const host = view.parent;
  type Realm = Window & { JSON: JSON; MessageEvent: typeof MessageEvent };
  const deliver = (to: Window, from: Window) => (data: unknown) =>
    void setTimeout(() => to.dispatchEvent(new (to as Realm).MessageEvent("message", { data: (to as Realm).JSON.parse(JSON.stringify(data)), source: from })));
  const hostPost = host.postMessage;
  host.postMessage = deliver(host, view);
  onTestFinished(() => void (host.postMessage = hostPost));
  // The transport logs each message to console.debug.
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  onTestFinished(() => debug.mockRestore());
  await bridge.connect(new PostMessageTransport(view, view));
  // jsdom ignores srcdoc, so the document is written in. Nor has it ResizeObserver, which the view's size reports use.
  const inner = frame.contentDocument!;
  inner.open();
  inner.write(RUN_CARD_HTML.replace("<head>", "<head><script>window.ResizeObserver = class { observe() {} disconnect() {} }; console.debug = () => {};</script>"));
  inner.close();
  view.postMessage = deliver(view, host);
  await initialized;
  await bridge.sendToolInput({ arguments: { run_id: run.id } });
  await bridge.sendToolResult(textResult(run));
  await waitFor(() => expect(within(inner.body).getByRole("region", { name: "Run 7f3a2c1e" })).toBeInTheDocument());
  expect(within(inner.body).getByText("Shaping tools in the catalog")).toBeInTheDocument();
  expect(inner.documentElement).toHaveAttribute("data-theme", "dark");
});

test("the card follows the host's theme, light or dark", async () => {
  await show(textResult(run), { theme: "dark" });
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
  bridge!.setHostContext({ theme: "light" });
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
});

test("a run that waits for a permission or a question is answered from the card, through the host's tool calls", async () => {
  onTestFinished(unmountViews);
  const question = { id: "q1", node: "gate", question: "Which database?", options: ["postgres", "sqlite"] };
  const { calls } = await mountView(startRunCard, {
    input: { run_id: run.id },
    result: jsonResult({ ...run, questions: [question] }),
    tools: { answer_permission: () => jsonResult({ decision: "allowed", url: RUN_URL }), answer_question: () => jsonResult({ answered: true, run_id: run.id, url: RUN_URL }) },
  });
  const permission = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  fireEvent.click(permission.getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(permission.getByRole("status")).toHaveTextContent("Allowed once."));
  const asked = within(screen.getByRole("article", { name: "Which database?" }));
  fireEvent.click(asked.getByRole("button", { name: "sqlite" }));
  await waitFor(() => expect(asked.getByRole("status")).toHaveTextContent("Answered: sqlite"));
  expect(calls).toEqual([
    { name: "answer_permission", arguments: { request_id: "perm1", decision: "allow" } },
    { name: "answer_question", arguments: { question_id: "q1", option: "sqlite", answer: "sqlite" } },
  ]);
});

test("a question that asks for a review or a Try it links to its page", async () => {
  await show(
    textResult({
      ...run,
      permissions: [],
      questions: [
        { id: "q2", node: "plan-review", question: "Approve the plan?", options: ["approve", "changes"], review: "# Plan", review_url: `${RUN_URL}/review/q2` },
        { id: "q3", node: "try", question: "Does it work?", options: ["approve", "changes"], try: { url: `${RUN_URL}/try/q3` } },
      ],
    }),
  );
  expect(await screen.findByRole("link", { name: "Open the review" })).toHaveAttribute("href", `${RUN_URL}/review/q2`);
  expect(screen.getByRole("link", { name: "Open Try it" })).toHaveAttribute("href", `${RUN_URL}/try/q3`);
});
