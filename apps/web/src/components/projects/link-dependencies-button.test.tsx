import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { LinkDependenciesButton } from "./link-dependencies-button";

const actions = vi.hoisted(() => ({ linkDependenciesAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => actions);
beforeEach(() => actions.linkDependenciesAction.mockReset());

test("linking dependencies on GitHub says how many links it added", async () => {
  actions.linkDependenciesAction.mockResolvedValue({ ok: true, linked: 12 });
  render(<LinkDependenciesButton projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /Link Depends on lines on GitHub/ }));
  expect(await screen.findByText("Linked 12 dependencies on GitHub.")).toBeInTheDocument();
  expect(actions.linkDependenciesAction).toHaveBeenCalledWith({ projectId: "p1" });
});

test("with nothing to link it says so, and a failure shows the error", async () => {
  actions.linkDependenciesAction.mockResolvedValueOnce({ ok: true, linked: 0 }).mockResolvedValueOnce({ ok: false, error: "Resource not accessible by integration" });
  render(<LinkDependenciesButton projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /Link Depends on lines on GitHub/ }));
  expect(await screen.findByText("Every Depends on line is already linked.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Link Depends on lines on GitHub/ }));
  expect(await screen.findByText("Resource not accessible by integration")).toBeInTheDocument();
});
