import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTab } from "./plan-tab";
import { epic, planView, story, task } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), setupPlanAction: vi.fn() }));
vi.mock("@/components/assistant/assistant-provider", () => ({ useOptionalAssistant: () => undefined }));

const READ_AT = Date.parse("2026-10-02T12:00:00Z");
const view = planView([epic(12, "Project management", [story(41, "Shaping", 12, [task(57, "Add the migration", "Ready"), task(58, "Plan page", "Shaping")])])]);
const props = {
  project: { id: "p1", name: "handoff", repoOwner: "o", repoName: "r" },
  plan: view,
  view: "tree" as const,
  filters: parsePlanFilters({}),
  signals: { needsYou: [], skipped: {} },
  start: { graphs: ["loop"], graphName: "loop" },
  readAt: READ_AT,
};

test("the activity line shows the latest issues, sub_issues or issue_dependencies delivery for the repository", () => {
  const { unmount } = render(
    <PlanTab {...props} activity={{ event: "issues", action: "closed", issue: 57, summary: "Issue #57 closed", receivedAt: new Date(READ_AT - 3 * 60_000) }} />,
  );
  expect(screen.getByText("Last from GitHub: Issue #57 closed, 3 minutes ago")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "1 Ready task in the backlog" })).toHaveAttribute("href", "/projects/p1/issues");
  expect(within(screen.getByRole("tree")).getByRole("treeitem", { name: /Task #57/ })).toBeInTheDocument();
  unmount();

  render(<PlanTab {...props} activity={null} />);
  expect(screen.queryByText(/Last from GitHub/)).not.toBeInTheDocument();
});
