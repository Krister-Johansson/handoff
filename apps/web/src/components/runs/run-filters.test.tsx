import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { RunFilters } from "./run-filters";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

test("status filters are links that keep the chosen project", () => {
  render(<RunFilters filter={{ project: "sandbox" }} projects={["demo", "sandbox"]} />);
  expect(screen.getByRole("link", { name: "Failed" })).toHaveAttribute("href", "/runs?status=failed&project=sandbox");
  expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/runs?project=sandbox");
});

test("the current status is marked", () => {
  render(<RunFilters filter={{ status: "active" }} projects={[]} />);
  expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
});

test("choosing a project navigates with the status kept", () => {
  render(<RunFilters filter={{ status: "failed" }} projects={["demo", "sandbox"]} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "sandbox" } });
  expect(push).toHaveBeenCalledWith("/runs?status=failed&project=sandbox");
});
