import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { FoundIssue } from "@/server/issue-page";
import { IssueView } from "./issue-view";
import { epicPage, MILESTONES, NOW, PROJECT_REF, START, taskPage, unplannedPage, issueDetail, planMilestone } from "./testing/issue-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
const actions = vi.hoisted(() => ({ setMilestoneAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/projects/p1/issues/16" }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), planIssueAction: vi.fn(), scheduleAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));
vi.mock("@/app/projects/issue-actions", () => ({ assignAction: vi.fn(), assignableAction: vi.fn(), startIssueRunAction: vi.fn(), setMilestoneAction: actions.setMilestoneAction }));
vi.mock("@/components/assistant/assistant-provider", () => ({ useOptionalAssistant: () => undefined }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => null }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

beforeEach(() => {
  actions.setMilestoneAction.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  toast.dismiss();
});

function show(page: FoundIssue) {
  return render(
    <>
      <IssueView project={PROJECT_REF} page={page} runs={[]} start={START} now={NOW} readAt={NOW.getTime()} />
      <Toaster />
    </>,
  );
}

/** Task #16, in no milestone of its own, inheriting 0.9 from epic #121. */
function inheriting(over: Partial<FoundIssue> = {}): FoundIssue {
  const page = taskPage({ milestones: MILESTONES, ...over });
  if (!page.place.planned || page.place.kind !== "task") throw new Error("expected a task");
  return { ...page, place: { ...page.place, item: { ...page.place.item, milestone: { number: 2, title: "0.9", inherited: { kind: "epic", issue: 121 } } } } };
}

/** Task #16 in 1.0 of its own. */
function own(): FoundIssue {
  const page = taskPage({ milestones: MILESTONES });
  if (!page.place.planned || page.place.kind !== "task") throw new Error("expected a task");
  return {
    ...page,
    issue: { ...page.issue, milestone: { number: 3, title: "1.0" } },
    place: { ...page.place, item: { ...page.place.item, milestone: { number: 3, title: "1.0" } } },
  };
}

const section = () => within(screen.getByRole("complementary", { name: "Where #16 sits" })).getByRole("region", { name: "Milestone" });

test("a task in no milestone of its own shows the one it inherits from its epic, with the due date, its tasks done and the Timeline's end", () => {
  show(inheriting());
  const milestone = section();
  const button = within(milestone).getByRole("button", { name: "Milestone 0.9, from epic #121. Change the milestone of #16" });
  expect(button).toHaveTextContent("0.9from epic #121");
  expect(milestone).toHaveTextContent("Due Oct 20. 2 of 11 tasks done. Ends Oct 18, 2 days early.");
  // The section sits right under In the plan, as the design draws it.
  const titles = within(screen.getByRole("complementary", { name: "Where #16 sits" }))
    .getAllByRole("region")
    .map((r) => r.querySelector("h2")?.textContent);
  expect(titles.slice(0, 3)).toEqual(["In the plan", "Milestone", "Part of"]);
});

test("in a Flow project the note says where the milestone ends in the order, with no forecast", () => {
  const flowing = MILESTONES.map((m) => (m.number === 2 ? planMilestone(2, "0.9", "2026-10-20", "open", { done: 2, total: 11, flow: { last: { issue: 62, place: 6 }, skipped: [] } }) : m));
  show(inheriting({ planMode: "flow", milestones: flowing }));
  expect(section()).toHaveTextContent("Due Oct 20. 2 of 11 tasks done. Ends after Next 6.");
  expect(section()).not.toHaveTextContent(/early|late/);
});

test("the picker lists the open milestones with their due dates, the closed ones under Closed that cannot be picked, and says a pick sets this issue alone", () => {
  show(inheriting());
  fireEvent.click(within(section()).getByRole("button", { name: /^Milestone 0\.9/ }));
  const picker = screen.getByRole("dialog", { name: "Milestone of #16" });
  expect(within(picker).getByPlaceholderText("Filter milestones")).toBeInTheDocument();
  const options = within(picker).getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["0.9From epic #121Due Oct 20", "1.0Due Nov 30", "0.8Due Sep 12"]);
  expect(within(options[0]!).getByLabelText("Current milestone")).toBeInTheDocument();
  expect(options[2]).toHaveAttribute("aria-disabled", "true");
  expect(within(picker).getByText("Open")).toBeInTheDocument();
  expect(within(picker).getByText("Closed")).toBeInTheDocument();
  // Nothing of its own to clear.
  expect(within(picker).queryByRole("option", { name: /Clear/ })).not.toBeInTheDocument();
  expect(picker).toHaveTextContent("A pick sets the milestone on #16 only and saves to GitHub at once, with Undo. Create and close milestones on GitHub.");
});

test("a pick saves to GitHub at once, and the toast's Undo puts the milestone it had back", async () => {
  actions.setMilestoneAction.mockResolvedValueOnce({ ok: true, milestone: { number: 2, title: "0.9" }, from: { number: 3, title: "1.0" } });
  actions.setMilestoneAction.mockResolvedValueOnce({ ok: true, milestone: { number: 3, title: "1.0" }, from: { number: 2, title: "0.9" } });
  show(own());
  fireEvent.click(within(section()).getByRole("button", { name: "Milestone 1.0. Change the milestone of #16" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Milestone of #16" })).getByRole("option", { name: /^0\.9/ }));

  await waitFor(() => expect(actions.setMilestoneAction).toHaveBeenCalledWith({ projectId: "p1", issue: 16, milestone: 2 }));
  expect(await screen.findByText("#16 is in 0.9")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.setMilestoneAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 16, milestone: 3 }));
  expect(await screen.findByText("#16 is back in 1.0")).toBeInTheDocument();
  expect(actions.setMilestoneAction).toHaveBeenCalledTimes(2);
});

test("Clear takes the issue's own milestone off, and Undo puts it back", async () => {
  actions.setMilestoneAction.mockResolvedValueOnce({ ok: true, milestone: null, from: { number: 3, title: "1.0" } });
  actions.setMilestoneAction.mockResolvedValueOnce({ ok: true, milestone: { number: 3, title: "1.0" }, from: null });
  show(own());
  fireEvent.click(within(section()).getByRole("button", { name: /^Milestone 1\.0/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Milestone of #16" })).getByRole("option", { name: "Clear the milestone" }));

  await waitFor(() => expect(actions.setMilestoneAction).toHaveBeenCalledWith({ projectId: "p1", issue: 16, milestone: null }));
  expect(await screen.findByText("Cleared the milestone of #16")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.setMilestoneAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 16, milestone: 3 }));
});

test("a refused pick says why in the section and changes nothing", async () => {
  actions.setMilestoneAction.mockResolvedValueOnce({ ok: false, error: "Setting a milestone needs GitHub access to the repository (GITHUB_TOKEN or a GitHub App)." });
  show(inheriting());
  fireEvent.click(within(section()).getByRole("button", { name: /^Milestone 0\.9/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Milestone of #16" })).getByRole("option", { name: /^1\.0/ }));

  expect(await within(section()).findByRole("alert")).toHaveTextContent("Setting a milestone needs GitHub access to the repository (GITHUB_TOKEN or a GitHub App).");
  expect(await within(section()).findByRole("button", { name: /^Milestone 0\.9, from epic #121/ })).toBeInTheDocument();
  expect(router.refresh).not.toHaveBeenCalled();
});

test("an epic's picker says the pick sets the epic alone and the items under it inherit it", () => {
  const page = epicPage();
  if (!page.place.planned || page.place.kind !== "epic") throw new Error("expected an epic");
  show({ ...page, milestones: MILESTONES, issue: { ...page.issue, milestone: { number: 2, title: "0.9" } }, place: { ...page.place, item: { ...page.place.item, milestone: { number: 2, title: "0.9" } } } });
  const milestone = within(screen.getByRole("complementary", { name: "Where #121 sits" })).getByRole("region", { name: "Milestone" });
  fireEvent.click(within(milestone).getByRole("button", { name: "Milestone 0.9. Change the milestone of #121" }));
  expect(screen.getByRole("dialog", { name: "Milestone of #121" })).toHaveTextContent(
    "A pick sets the milestone on #121 only and saves to GitHub at once, with Undo. Its stories and tasks without one of their own inherit it. Create and close milestones on GitHub.",
  );
});

test("a task in no milestone offers to set one, and an issue outside the plan shows its milestone without a picker", () => {
  const { unmount } = show(taskPage({ milestones: MILESTONES }));
  expect(within(section()).getByRole("button", { name: "No milestone. Set the milestone of #16" })).toHaveTextContent("No milestone");
  unmount();

  show({ ...unplannedPage(), milestones: MILESTONES, issue: issueDetail(407, "Outside", { milestone: { number: 3, title: "1.0" } }) });
  const outside = within(screen.getByRole("complementary", { name: "Where #407 sits" })).getByRole("region", { name: "Milestone" });
  expect(outside).toHaveTextContent("1.0");
  expect(outside).toHaveTextContent("Due Nov 30. 0 of 7 tasks done. No task has dates yet. Plan #407 to change its milestone here.");
  expect(within(outside).queryByRole("button")).not.toBeInTheDocument();
});
