import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { waitFor, within } from "@testing-library/react";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { textResult } from "./testing";
import { NEEDS_YOU_HTML, PERMISSION_CARD_HTML, PLAN_LIST_HTML, QUESTION_CARD_HTML } from "./views.generated";

let bridge: AppBridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
  document.body.innerHTML = "";
});

/**
 * Loads a bundled page in an iframe and connects a host to it over postMessage, as a host loads a view, then sends
 * the tool's input and result. Returns the frame's document.
 */
async function load(html: string, input: Record<string, unknown>, result: ReturnType<typeof textResult>) {
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
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  onTestFinished(() => debug.mockRestore());
  await bridge.connect(new PostMessageTransport(view, view));
  // jsdom ignores srcdoc, so the document is written in. Nor has it ResizeObserver, which the view's size reports use.
  const inner = frame.contentDocument!;
  inner.open();
  inner.write(html.replace("<head>", "<head><script>window.ResizeObserver = class { observe() {} disconnect() {} }; console.debug = () => {};</script>"));
  inner.close();
  view.postMessage = deliver(view, host);
  await initialized;
  await bridge.sendToolInput({ arguments: input });
  await bridge.sendToolResult(result);
  return inner;
}

const RUN_URL = "http://localhost:3000/projects/p1/runs/7f3a2c1e-0000-4000-8000-000000000001";
const empty = { permissions: [], reviews: [], questions: [], ready_to_merge: [], failed_runs: [], stuck_runs: [], pull_requests: [] };

test("each bundled page starts the view its root names, in an iframe, over postMessage", async () => {
  let inner = await load(NEEDS_YOU_HTML, {}, textResult(empty));
  await waitFor(() => expect(within(inner.body).getByRole("region", { name: "Needs you" })).toBeInTheDocument());
  expect(inner.documentElement).toHaveAttribute("data-theme", "dark");
  await bridge!.close();

  inner = await load(PERMISSION_CARD_HTML, { request_id: "perm1", decision: "allow" }, textResult({ decision: "allowed", url: RUN_URL }));
  await waitFor(() => expect(within(inner.body).getByRole("status")).toHaveTextContent("Allowed once."));
  await bridge!.close();

  inner = await load(QUESTION_CARD_HTML, { question_id: "q1", answer: "Yes" }, textResult({ answered: true, run_id: "r1", url: RUN_URL }));
  await waitFor(() => expect(within(inner.body).getByRole("status")).toHaveTextContent("Answered."));
  await bridge!.close();

  const plan = { mode: "flow", project: { number: 3, title: "Sample roadmap", url: "https://github.com/users/octo/projects/3" }, lanes: 1, order: "project", held: [], queue: [], epics: [], unparented: [], unplanned: [] };
  inner = await load(PLAN_LIST_HTML, { project: "sandbox" }, textResult(plan));
  await waitFor(() => expect(within(inner.body).getByRole("region", { name: "Plan" })).toBeInTheDocument());
  expect(within(inner.body).getByText("1 run at once · Project order")).toBeInTheDocument();
});
