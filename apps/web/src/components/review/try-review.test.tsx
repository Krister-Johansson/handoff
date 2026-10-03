import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { TryReview } from "./try-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), restartTryItAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/runs/r1/try/q1",
}));

/** What a server action that redirects rejects with in the browser, once Next has started the navigation. */
const redirectTo = (path: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;push;${path};303;` });
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {}
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true });
  actions.restartTryItAction.mockReset().mockResolvedValue({ ok: true });
  Element.prototype.scrollIntoView = vi.fn();
});

const QUESTION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const running = { id: "p1", url: "http://localhost:41000", status: "running" as const };
const props = {
  questionId: QUESTION,
  runId: RUN,
  executionId: "gate-1",
  eventsAfter: 40,
  from: "coder-1",
  acceptance: ["A user can create a new project", "The project shows in the sidebar", "pnpm lint passes"],
  preview: running,
  shots: [
    { id: "a1", caption: "The create dialog", criterion: "A user can create a new project", works: true },
    { id: "a2", caption: "The sidebar", criterion: "The project shows in the sidebar", works: true },
    { id: "a3", caption: "Dark theme at 320 px", works: true },
  ],
};

const section = (name: string) => screen.getByRole("region", { name });

test("each criterion is a section to check, with its screenshots, and the app opens from the top", () => {
  render(<TryReview {...props} />);
  expect(screen.getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41000");
  expect(screen.getByRole("button", { name: /1 of 3/ })).toBeInTheDocument();
  expect(screen.getByText("0 of 3 checked")).toBeInTheDocument();
  expect(within(section("A user can create a new project")).getByRole("img", { name: "The create dialog" })).toBeInTheDocument();
  // Screenshots that show no criterion get their own section at the end.
  expect(within(section("Other screenshots")).getByRole("img", { name: "Dark theme at 320 px" })).toBeInTheDocument();
});

test("marking a criterion as working collapses it and moves on to the next one to check", () => {
  render(<TryReview {...props} />);
  const first = section("A user can create a new project");
  fireEvent.click(within(first).getByRole("checkbox", { name: "Works" }));
  expect(within(first).getByRole("button", { name: "Expand A user can create a new project" })).toHaveAttribute("aria-expanded", "false");
  expect(within(first).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("1 of 3 checked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /2 of 3/ })).toBeInTheDocument();
  // ] moves on, [ goes back.
  fireEvent.keyDown(window, { key: "]" });
  expect(screen.getByRole("button", { name: /3 of 3/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "[" });
  expect(screen.getByRole("button", { name: /2 of 3/ })).toBeInTheDocument();
});

test("Approve submits in one click when every criterion works", async () => {
  render(<TryReview {...props} />);
  for (const name of props.acceptance.slice(0, -1)) fireEvent.click(within(section(name)).getByRole("checkbox", { name: "Works" }));
  // With a criterion still to check, Submit opens the choice.
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  fireEvent.click(within(section(props.acceptance.at(-1)!)).getByRole("checkbox", { name: "Works" }));
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN, option: "approve", note: "", comments: [] }));
});

test("the app link updates when the app is started again", async () => {
  render(<TryReview {...props} />);
  const stream = FakeEventSource.instances.at(-1)!;
  expect(stream.url).toBe(`/api/runs/${RUN}/events?after=40`);
  fireEvent.click(screen.getByRole("button", { name: "Start the app again" }));
  await waitFor(() => expect(actions.restartTryItAction).toHaveBeenCalled());
  // Another step's app does not change the gate's link.
  act(() => stream.emit({ seq: 41, type: "preview.started", payload: { id: "p0", url: "http://localhost:42000" }, nodeExecutionId: "demo-1", createdAt: "2026-10-03T10:00:00Z" }));
  expect(screen.getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41000");
  act(() => stream.emit({ seq: 42, type: "preview.started", payload: { id: "p2", url: "http://localhost:41007" }, nodeExecutionId: "gate-1", createdAt: "2026-10-03T10:00:01Z" }));
  expect(screen.getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41007");
  act(() => stream.emit({ seq: 43, type: "preview.failed", payload: { error: "port 41007 is taken" }, nodeExecutionId: "gate-1", createdAt: "2026-10-03T10:00:02Z" }));
  expect(screen.queryByRole("link", { name: /Open the app/ })).not.toBeInTheDocument();
  expect(screen.getByText("port 41007 is taken")).toBeInTheDocument();
});

test("an answered Try it does not follow the run's events", () => {
  FakeEventSource.instances = [];
  render(<TryReview {...props} answered={{ option: "approve", comments: [] }} />);
  expect(FakeEventSource.instances).toHaveLength(0);
});

test("a criterion that does not work stays open for what is wrong, and goes back to the coder", async () => {
  render(<TryReview {...props} />);
  const second = section("The project shows in the sidebar");
  fireEvent.click(within(second).getByRole("button", { name: "Doesn't work" }));
  fireEvent.change(within(second).getByLabelText("What is wrong?"), { target: { value: "It shows only after a reload." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Send back to coder-1" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ option: "changes", comments: [{ quote: "The project shows in the sidebar", body: "It shows only after a reload." }] }),
    ),
  );
});

test("an app that did not start says why and can be started again", async () => {
  render(<TryReview {...props} preview={{ status: "failed", error: "This repository has no .claude/launch.json" }} />);
  expect(screen.getByText(/no \.claude\/launch\.json/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open the app/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start the app again" }));
  await waitFor(() => expect(actions.restartTryItAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN }));
});

test("an answered review shows each criterion's result and asks nothing more", () => {
  render(<TryReview {...props} answered={{ option: "changes", comments: [{ quote: "The project shows in the sidebar", body: "Only after a reload." }] }} />);
  expect(within(section("The project shows in the sidebar")).getByText("Only after a reload.")).toBeInTheDocument();
  expect(within(section("The project shows in the sidebar")).getByText("Doesn't work")).toBeInTheDocument();
  expect(within(section("A user can create a new project")).getByText("Works")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  // The app stopped when the gate was answered.
  expect(screen.queryByRole("link", { name: /Open the app/ })).not.toBeInTheDocument();
  expect(screen.getByText("The app stopped when this was answered.")).toBeInTheDocument();
});

test("new warnings from the server log and the console are marked new", () => {
  const warnings = [
    { source: "server" as const, level: "error" as const, text: "Error: could not load tasks", new: true },
    { source: "server" as const, level: "warning" as const, text: "Warning: the old API is deprecated", new: false },
    { source: "console" as const, level: "warning" as const, text: "Image is missing an alt attribute", new: true },
  ];
  render(<TryReview {...props} warnings={warnings} />);
  const list = section("Warnings and errors");
  const item = (text: string) => within(list).getByText(text).closest("li")!;
  expect(within(list).getByText("2 new since the previous demo")).toBeInTheDocument();
  expect(within(item("Error: could not load tasks")).getByText("New")).toBeInTheDocument();
  expect(within(item("Error: could not load tasks")).getByText("Server log")).toBeInTheDocument();
  expect(within(item("Image is missing an alt attribute")).getByText("New")).toBeInTheDocument();
  expect(within(item("Image is missing an alt attribute")).getByText("Console")).toBeInTheDocument();
  expect(within(item("Warning: the old API is deprecated")).queryByText("New")).not.toBeInTheDocument();
});

test("a demo without warnings shows no warnings section", () => {
  render(<TryReview {...props} />);
  expect(screen.queryByRole("region", { name: "Warnings and errors" })).not.toBeInTheDocument();
});

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/**
 * Try it inside the assistant, with a turn running so the test can call the page's tools as the model
 * would: `call` emits a ui_call and resolves with the page's answer.
 */
async function withAssistant(overrides: Partial<ComponentProps<typeof TryReview>> = {}) {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <TryReview {...props} {...overrides} />
    </AssistantProvider>,
  );
  act(() => void port!.send("what is on this page"));
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

const cursor = () => screen.getByRole("button", { name: / of 3$/ });

test("page_mark_criterion ticks a criterion by index or text, collapses it and moves on; with works false and a note the note shows in the criterion", async () => {
  const { call, whereAmI } = await withAssistant();
  const first = section("A user can create a new project");

  expect(await call("page_mark_criterion", { index: 1, works: true })).toEqual({ text: "Marked criterion 1 as working. Now on criterion 2.", isError: false });
  expect(within(first).getByRole("button", { name: "Expand A user can create a new project" })).toHaveAttribute("aria-expanded", "false");
  expect(within(first).getByRole("checkbox", { name: "Works" })).toBeChecked();
  expect(screen.getByText("1 of 3 checked")).toBeInTheDocument();
  expect(cursor()).toHaveTextContent("2 of 3");

  // By its text, as the person says it: case and surrounding space do not matter.
  expect(await call("page_mark_criterion", { criterion: " the project shows in the sidebar", works: false, note: "It shows only after a reload." })).toEqual({
    text: "Marked criterion 2 as not working, with the note.",
    isError: false,
  });
  const second = section("The project shows in the sidebar");
  expect(within(second).getByRole("button", { name: "Doesn't work" })).toHaveAttribute("aria-pressed", "true");
  expect(within(second).getByLabelText("What is wrong?")).toHaveValue("It shows only after a reload.");
  expect(screen.getByText("2 of 3 checked")).toBeInTheDocument();

  // null clears a mark.
  expect(await call("page_mark_criterion", { index: 1, works: null })).toEqual({ text: "Unchecked criterion 1.", isError: false });
  expect(within(first).getByRole("checkbox", { name: "Works" })).not.toBeChecked();
  expect((await whereAmI()).page?.state.data).toMatchObject({
    criteria: [
      { index: 1, text: "A user can create a new project", works: null, note: "" },
      { index: 2, text: "The project shows in the sidebar", works: false, note: "It shows only after a reload." },
      { index: 3, text: "pnpm lint passes", works: null, note: "" },
    ],
  });

  expect(await call("page_mark_criterion", { index: 4, works: true })).toEqual({ text: "There is no criterion 4. The criteria run from 1 to 3.", isError: true });
  expect(await call("page_mark_criterion", { criterion: "The app is fast", works: true })).toEqual({
    text: 'No criterion reads "The app is fast". The criteria are: 1. A user can create a new project; 2. The project shows in the sidebar; 3. pnpm lint passes.',
    isError: true,
  });
  expect(await call("page_mark_criterion", { works: true })).toEqual({ text: "Name the criterion by its index or its text.", isError: true });
});

test("page_go_to_criterion moves next, previous and to an index", async () => {
  const { call, whereAmI } = await withAssistant();
  expect(cursor()).toHaveTextContent("1 of 3");

  expect(await call("page_go_to_criterion", { direction: "next" })).toEqual({ text: 'Now on criterion 2 of 3: "The project shows in the sidebar".', isError: false });
  expect(cursor()).toHaveTextContent("2 of 3");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

  expect(await call("page_go_to_criterion", { index: 3 })).toEqual({ text: 'Now on criterion 3 of 3: "pnpm lint passes".', isError: false });
  expect(cursor()).toHaveTextContent("3 of 3");
  expect((await whereAmI()).page?.state.data).toMatchObject({ current: 3 });

  // With nothing given it moves on; past the last one it stays.
  expect(await call("page_go_to_criterion")).toEqual({ text: 'Already on the last criterion, 3 of 3: "pnpm lint passes".', isError: false });

  expect(await call("page_go_to_criterion", { direction: "previous" })).toEqual({ text: 'Now on criterion 2 of 3: "The project shows in the sidebar".', isError: false });
  expect(cursor()).toHaveTextContent("2 of 3");

  expect(await call("page_go_to_criterion", { index: 5 })).toEqual({ text: "There is no criterion 5. The criteria run from 1 to 3.", isError: true });
  expect(cursor()).toHaveTextContent("2 of 3");
});

test("page_submit approve is refused while a criterion is unticked, and after approval calls answerReviewAction with approve", async () => {
  const { call } = await withAssistant();
  await call("page_mark_criterion", { index: 1, works: true });

  expect(await call("page_submit", { option: "approve" })).toEqual({ text: "Check every criterion to approve. Not marked as working: 2, 3.", isError: true });
  expect(actions.answerReviewAction).not.toHaveBeenCalled();

  await call("page_mark_criterion", { index: 2, works: true });
  await call("page_mark_criterion", { index: 3, works: true });
  // On success the action redirects to the run page, which Next reports to the caller as a rejection.
  actions.answerReviewAction.mockRejectedValueOnce(redirectTo(`/projects/p1/runs/${RUN}`));
  expect(await call("page_submit", { option: "approve" })).toEqual({ text: "Approved: every criterion works. The run page opens.", isError: false });
  expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN, option: "approve", note: "", comments: [] });
});

test("page_submit changes sends the failing criteria as comments with the note", async () => {
  const { call, whereAmI } = await withAssistant();
  expect(await call("page_submit", { option: "changes" })).toEqual({
    text: "Say what to change: mark a criterion that does not work, or add a note.",
    isError: true,
  });

  await call("page_mark_criterion", { index: 2, works: false, note: "It shows only after a reload." });
  await call("page_mark_criterion", { index: 3, works: false });
  // The overall note is the popover's: page_set_note writes it, and a note given to page_submit replaces it.
  expect(await call("page_set_note", { note: "Check dark mode too." })).toEqual({ text: 'Set the overall note to "Check dark mode too."', isError: false });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getByLabelText("Note (optional)")).toHaveValue("Check dark mode too.");
  expect((await whereAmI()).page?.state.data).toMatchObject({ note: "Check dark mode too." });

  actions.answerReviewAction.mockRejectedValueOnce(redirectTo(`/projects/p1/runs/${RUN}`));
  expect(await call("page_submit", { option: "changes", note: "Both are in the sidebar." })).toEqual({
    text: "Sent back to coder-1: 2 criteria do not work, with the note. The run page opens.",
    isError: false,
  });
  expect(actions.answerReviewAction).toHaveBeenCalledWith({
    questionId: QUESTION,
    runId: RUN,
    option: "changes",
    note: "Both are in the sidebar.",
    comments: [
      { quote: "The project shows in the sidebar", body: "It shows only after a reload." },
      { quote: "pnpm lint passes", body: "Does not work." },
    ],
  });
  expect(screen.getByLabelText("Note (optional)")).toHaveValue("Both are in the sidebar.");

  // What the action refuses comes back as the tool's error.
  actions.answerReviewAction.mockResolvedValueOnce({ ok: false, error: "This question was already answered." });
  expect(await call("page_submit", { option: "changes" })).toEqual({ text: "This question was already answered.", isError: true });
});

test("page_restart_app calls restartTryItAction", async () => {
  const { call, whereAmI } = await withAssistant({ preview: { status: "failed", error: "Port 41000 is in use" } });
  expect((await whereAmI()).page?.state.data).toMatchObject({ app: { status: "failed", url: null, error: "Port 41000 is in use" } });

  expect(await call("page_restart_app")).toEqual({ text: "Started the app again from the run's branch.", isError: false });
  expect(actions.restartTryItAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN });

  // A restart that fails says why, as the app bar does.
  actions.restartTryItAction.mockResolvedValueOnce({ ok: false, error: "The run's workspace is gone." });
  expect(await call("page_restart_app")).toEqual({ text: "The run's workspace is gone.", isError: true });
  expect(within(screen.getByRole("region", { name: "The app" })).getByText("The run's workspace is gone.")).toBeInTheDocument();
});

test("an answered Try it binds only navigation tools", async () => {
  const answered = { option: "changes", comments: [{ quote: "The project shows in the sidebar", body: "Only after a reload." }] };
  const { call, whereAmI } = await withAssistant({ answered });
  const page = (await whereAmI()).page!;
  expect(page.tools.map((t) => t.name)).toEqual(["page_go_to_criterion", "page_expand_criteria"]);
  expect(page.state.data).toMatchObject({ readOnly: true, app: { status: "stopped" } });

  expect(await call("page_go_to_criterion", { index: 2 })).toEqual({ text: 'Now on criterion 2 of 3: "The project shows in the sidebar".', isError: false });
  expect(cursor()).toHaveTextContent("2 of 3");

  // The working criteria start collapsed; all expands them and all false collapses every one.
  const first = () => within(section("A user can create a new project")).getByRole("button", { name: /A user can create a new project$/ });
  expect(first()).toHaveAttribute("aria-expanded", "false");
  expect(await call("page_expand_criteria", { all: true })).toEqual({ text: "Expanded every criterion.", isError: false });
  expect(first()).toHaveAttribute("aria-expanded", "true");
  expect(await call("page_expand_criteria", { all: false })).toEqual({ text: "Collapsed every criterion.", isError: false });
  expect(first()).toHaveAttribute("aria-expanded", "false");

  for (const name of ["page_mark_criterion", "page_set_note", "page_submit", "page_restart_app"]) {
    expect(await call(name, { index: 1, works: true, note: "x", option: "approve" })).toMatchObject({ isError: true, text: expect.stringContaining(`${name} is not available here`) });
  }
  expect(actions.answerReviewAction).not.toHaveBeenCalled();
  expect(actions.restartTryItAction).not.toHaveBeenCalled();
});

test("page tool calls that arrive back to back each see what the call before changed", async () => {
  const { transport } = await withAssistant();
  // A browser agent can send the next call before React has rendered the last one's changes.
  await act(async () => {
    transport.emit({ type: "ui_call", requestId: "b1", name: "page_mark_criterion", args: { index: 1, works: true } });
    transport.emit({ type: "ui_call", requestId: "b2", name: "page_mark_criterion", args: { index: 2, works: true } });
    transport.emit({ type: "ui_call", requestId: "b3", name: "page_go_to_criterion", args: { index: 1 } });
    transport.emit({ type: "ui_call", requestId: "b4", name: "page_go_to_criterion", args: { direction: "next" } });
  });
  await waitFor(() => expect(transport.uiReplies).toHaveLength(4));
  expect(transport.uiReplies.map((r) => r.text)).toEqual([
    "Marked criterion 1 as working. Now on criterion 2.",
    "Marked criterion 2 as working. Now on criterion 3.",
    'Now on criterion 1 of 3: "A user can create a new project".',
    'Now on criterion 2 of 3: "The project shows in the sidebar".',
  ]);
  expect(screen.getByText("2 of 3 checked")).toBeInTheDocument();
  expect(cursor()).toHaveTextContent("2 of 3");
});
