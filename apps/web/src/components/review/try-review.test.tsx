import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { TryReview } from "./try-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), restartTryItAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/projects/p1/runs/r1/try/q1" }));
beforeEach(() => {
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

test("approving needs every criterion to work", async () => {
  render(<TryReview {...props} />);
  for (const name of props.acceptance) fireEvent.click(within(section(name)).getByRole("checkbox", { name: "Works" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN, option: "approve", note: "", comments: [] }));
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
