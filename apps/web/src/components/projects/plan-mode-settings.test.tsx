import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PlanModeSettings } from "./plan-mode-settings";

const actions = vi.hoisted(() => ({
  setPlanModeAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addDateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addEstimateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
});

test("the Plan mode section shows Flow and Timeline as radio cards and Save writes the picked mode", async () => {
  render(<PlanModeSettings projectId="p1" initial="timeline" />);
  const section = screen.getByRole("region", { name: "Plan mode" });
  expect(section).toHaveTextContent("How this project plans its work. The Plan page, the planner and the MCP tools all follow it.");
  const group = within(section).getByRole("radiogroup", { name: "Plan mode" });
  const flow = within(group).getByRole("radio", { name: "Flow" });
  const timeline = within(group).getByRole("radio", { name: "Timeline" });
  expect(flow).toHaveAccessibleDescription(/Order, no dates/);
  expect(timeline).toHaveAccessibleDescription(/Dates and estimates/);
  expect(section).toHaveTextContent("Agents set only the order and the blockers: what starts first and what waits for what. No dates.");
  expect(section).toHaveTextContent("Agents set Start and Target dates and sizes, and schedule work by date.");
  expect(section).toHaveTextContent("Switching to Timeline keeps the order. Tasks get dates when someone or an agent schedules them.");
  expect(timeline).toBeChecked();
  expect(flow).not.toBeChecked();

  // Save writes only a change.
  const save = within(section).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.click(flow);
  expect(flow).toBeChecked();
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(actions.setPlanModeAction).toHaveBeenCalledWith({ projectId: "p1", mode: "flow" }));
  expect(actions.setPlanModeAction).toHaveBeenCalledTimes(1);
});

test("a refused save shows why and keeps the pick", async () => {
  actions.setPlanModeAction.mockResolvedValueOnce({ ok: false, error: "The project no longer exists." });
  render(<PlanModeSettings projectId="p1" initial="flow" />);
  fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("The project no longer exists.")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Timeline" })).toBeChecked();
});

const SIZE_ONLY = { start: false, target: false, size: true, estimate: false };

test("picking Timeline names the fields the Project lacks and offers Add the fields, and Save works without them", async () => {
  actions.addDateFieldsAction.mockResolvedValueOnce({ ok: false, error: "GitHub refused the field." });
  render(<PlanModeSettings projectId="p1" initial="flow" fields={SIZE_ONLY} />);
  const section = screen.getByRole("region", { name: "Plan mode" });
  // Flow reads only Size, which the Project has.
  expect(section).not.toHaveTextContent(/has no/);
  expect(within(section).queryByRole("button", { name: "Add the fields" })).not.toBeInTheDocument();

  fireEvent.click(within(section).getByRole("radio", { name: "Timeline" }));
  expect(section).toHaveTextContent("The GitHub Project has no Start, Target or Estimate field, which Timeline mode reads.");
  fireEvent.click(within(section).getByRole("button", { name: "Add the fields" }));
  // The mode is not saved yet, so the fields are added for Timeline, as Settings, Projects adds them in a Timeline project.
  await waitFor(() => expect(actions.addDateFieldsAction).toHaveBeenCalledWith({ projectId: "p1", mode: "timeline" }));
  await waitFor(() => expect(actions.addEstimateFieldsAction).toHaveBeenCalledWith({ projectId: "p1", mode: "timeline" }));
  expect(await within(section).findByText("GitHub refused the field.")).toBeInTheDocument();

  fireEvent.click(within(section).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.setPlanModeAction).toHaveBeenCalledWith({ projectId: "p1", mode: "timeline" }));
});

test("a saved Timeline project still names the missing fields, and one with every field or no linked Project shows nothing", () => {
  const { unmount } = render(<PlanModeSettings projectId="p1" initial="timeline" fields={{ ...SIZE_ONLY, start: true, target: true }} />);
  expect(screen.getByRole("region", { name: "Plan mode" })).toHaveTextContent("The GitHub Project has no Estimate field, which Timeline mode reads.");
  unmount();

  for (const fields of [{ start: true, target: true, size: true, estimate: true }, undefined]) {
    const shown = render(<PlanModeSettings projectId="p1" initial="timeline" fields={fields} />);
    expect(screen.queryByRole("button", { name: "Add the fields" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Plan mode" })).not.toHaveTextContent(/has no/);
    shown.unmount();
  }
});
