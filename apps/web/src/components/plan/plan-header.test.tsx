import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlanHeader } from "./plan-header";
import { PROJECT } from "./testing/plan-fixtures";

test("the header is one line: Plan, the GitHub Project as a small link, and the Ready tasks in the backlog", () => {
  const { rerender } = render(
    <TooltipProvider>
      <PlanHeader crumbs={[]} projectId="p1" project={PROJECT} ready={2} />
    </TooltipProvider>,
  );
  expect(screen.getByRole("heading", { level: 1, name: /^Plan/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "handoff plan" })).toHaveAttribute("href", PROJECT.url);
  expect(screen.getByRole("link", { name: "handoff plan" })).toHaveAttribute("title", "Open the GitHub Project handoff plan");
  expect(screen.getByRole("link", { name: "2 Ready tasks in the backlog" })).toHaveAttribute("href", "/projects/p1/issues");
  expect(screen.queryByRole("button", { name: /Shape with the assistant/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open on GitHub/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Only Ready tasks reach the backlog/)).not.toBeInTheDocument();

  rerender(
    <TooltipProvider>
      <PlanHeader crumbs={[]} projectId="p1" project={PROJECT} ready={1} />
    </TooltipProvider>,
  );
  expect(screen.getByRole("link", { name: "1 Ready task in the backlog" })).toBeInTheDocument();
});
