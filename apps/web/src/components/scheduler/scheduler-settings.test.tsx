import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SchedulerSettings } from "./scheduler-settings";
import { cardOf, FORM, OFF, PROJECT } from "./testing/fixtures";

const actions = vi.hoisted(() => ({
  turnOnSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  saveSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  pauseSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  resumeSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  turnOffSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  releaseTaskAction: vi.fn(),
}));
vi.mock("@/app/projects/scheduler-actions", () => actions);
vi.mock("@/app/projects/actions", () => ({ listGitHubProjectsAction: vi.fn(), setupPlanAction: vi.fn() }));

afterEach(() => vi.clearAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => <TooltipProvider>{children}</TooltipProvider>;
const section = () => screen.getByRole("region", { name: "Scheduler" });

test("max runs takes 1 to 10, Priority order is disabled without a Priority field, the graph lists the project's graphs", () => {
  render(<SchedulerSettings project={PROJECT} card={cardOf({ status: { settings: { maxRuns: 10, order: "project", graphName: "fast", skipLabel: "human" } } })} form={FORM} />, { wrapper });
  const runs = within(section()).getByRole("spinbutton", { name: "Runs at a time" });
  expect(runs).toHaveValue(10);
  expect(within(section()).getByRole("button", { name: "One more" })).toBeDisabled();
  fireEvent.change(runs, { target: { value: "0" } });
  expect(runs).toHaveValue(1);
  expect(within(section()).getByRole("button", { name: "One fewer" })).toBeDisabled();

  expect(within(section()).getByRole("radio", { name: "Priority" })).toBeDisabled();
  expect(within(section()).getByText("GitHub Project #5 has no Priority field. Add a single select field named Priority to order by it.")).toBeInTheDocument();
  const graph = within(section()).getByRole("combobox", { name: "Graph" });
  expect(graph).toHaveValue("fast");
  expect(within(graph).getAllByRole("option").map((o) => o.textContent)).toEqual(["master", "fast"]);
  expect(within(section()).getByRole("textbox", { name: "Skips tasks labelled" })).toHaveValue("human");
  expect(within(section()).getByText(/The worker runs 1 Claude process at a time for all projects \(HANDOFF_CAP_CLI\)/)).toBeInTheDocument();
});

test("with a Priority field the order can be Priority", () => {
  render(<SchedulerSettings project={PROJECT} card={cardOf()} form={{ ...FORM, priority: "project" }} />, { wrapper });
  expect(within(section()).getByRole("radio", { name: "Priority" })).toBeEnabled();
  expect(within(section()).queryByText(/has no Priority field/)).not.toBeInTheDocument();
});

test("Save keeps a pause and says so, Resume resumes, and Turn off turns the scheduler off", async () => {
  render(<SchedulerSettings project={PROJECT} card={cardOf({ status: { state: "paused", paused: { by: "person", reason: null, at: new Date() } } })} form={FORM} />, { wrapper });
  expect(within(section()).getByText("Paused")).toBeInTheDocument();
  expect(within(section()).getByText("Saving keeps the scheduler paused. Resume starts it again.")).toBeInTheDocument();
  fireEvent.click(within(section()).getByRole("button", { name: "One more" }));
  fireEvent.change(within(section()).getByRole("textbox", { name: "Skips tasks labelled" }), { target: { value: "" } });
  fireEvent.click(within(section()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.saveSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id, maxRuns: 3, order: "project", graph: "master", skipLabel: "" }));

  fireEvent.click(within(section()).getByRole("button", { name: "Resume the scheduler of todooverkill" }));
  await waitFor(() => expect(actions.resumeSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id }));
  fireEvent.click(within(section()).getByRole("button", { name: "Turn off the scheduler of todooverkill" }));
  await waitFor(() => expect(actions.turnOffSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id }));
});

test("off, the section turns the scheduler on with the fields and the approval sentence", async () => {
  render(<SchedulerSettings project={PROJECT} card={OFF} form={FORM} />, { wrapper });
  expect(within(section()).getByText("Off")).toBeInTheDocument();
  expect(within(section()).queryByRole("button", { name: /Turn off/ })).not.toBeInTheDocument();
  expect(within(section()).getByText("Let handoff start up to 1 run at a time on Ready tasks in todooverkill, in Project order, with graph master.")).toBeInTheDocument();
  fireEvent.click(within(section()).getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(actions.saveSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id, maxRuns: 1, order: "project", graph: "master", skipLabel: "human" }));
});

test("a project without a plan gets the refusal with Set up the plan", () => {
  render(<SchedulerSettings project={{ id: "p2", name: "sandbox" }} card={OFF} form={{ ...FORM, planNumber: null }} />, { wrapper });
  expect(within(section()).getByText("sandbox has no plan")).toBeInTheDocument();
  expect(within(section()).getByText("The scheduler starts runs on the plan's Ready tasks, so it needs a GitHub Project linked to sandbox first.")).toBeInTheDocument();
  expect(within(section()).getByRole("button", { name: "Set up the plan" })).toBeInTheDocument();
  expect(within(section()).queryByRole("spinbutton")).not.toBeInTheDocument();
});
