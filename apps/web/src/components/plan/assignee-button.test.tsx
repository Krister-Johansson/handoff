import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { loadImages } from "@/components/testing/images";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Assigning, type AssignControl } from "./plan-context";
import { PlanBoard } from "./plan-board";
import { PlanTree } from "./plan-tree";
import { epic, person, PROJECT, planView, REPO_URL, story, task } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), planIssueAction: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const epics = [
  epic(12, "Project management", [
    story(41, "Shaping", 12, [
      task(55, "Shaping tools", "Running", { assignees: [person("krister")] }),
      task(56, "Approval cards", "Running", { assignees: [person("example-dev", ""), person("krister")] }),
      task(57, "Add the migration", "Shaping"),
      task(59, "Old work", "Done", { state: "closed" }),
    ]),
  ]),
];
const base = { projectId: "p1", repoUrl: REPO_URL, needsYou: [] as string[], graphs: ["loop"], graphName: "loop", unparented: [], unplanned: [] };

/** A fake server side: krister is the token's user unless `me` is left out. */
function control(opts: { me?: string } = { me: "krister" }): AssignControl {
  return {
    me: opts.me,
    people: vi.fn(async () => [person("krister"), person("example-dev", "")]),
    assign: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
  };
}
const wrap = (value: AssignControl | undefined) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TooltipProvider>
        <Assigning value={value}>{children}</Assigning>
      </TooltipProvider>
    );
  };
const row = (name: RegExp) => screen.getByRole("treeitem", { name });

test("an open task with nobody offers Assign me first, then the people who can be assigned, and assigning leaves the status alone", async () => {
  const assigning = control();
  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(assigning) });
  expect(within(row(/Task #59/)).queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();

  fireEvent.click(within(row(/Task #57/)).getByRole("button", { name: "Assign #57" }));
  const popover = await screen.findByRole("dialog", { name: "Assign #57" });
  expect(within(popover).getByRole("option", { name: /Assign me/ })).toHaveTextContent("I will work on this");
  expect(within(popover).getByText("Assigning does not change the status.")).toBeInTheDocument();
  const people = await within(popover).findByRole("group", { name: "People who can be assigned" });
  expect(within(people).getAllByRole("option").map((o) => o.textContent)).toEqual(["KRkrister", "EXexample-dev"]);

  fireEvent.click(within(popover).getByRole("option", { name: /Assign me/ }));
  await waitFor(() => expect(assigning.assign).toHaveBeenCalledWith(57, { logins: [], me: true }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("the initials name the assignees; picking a person adds or removes them", async () => {
  const assigning = control();
  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(assigning) });
  const many = within(row(/Task #56/)).getByRole("button", { name: "Assignees: example-dev, krister. Change" });
  expect(many).toHaveTextContent("EX+1");

  fireEvent.click(within(row(/Task #55/)).getByRole("button", { name: "Assignee: krister. Change" }));
  const popover = await screen.findByRole("dialog", { name: "Assignee: krister. Change" });
  // I am assigned already, so there is no Assign me.
  expect(within(popover).queryByRole("option", { name: /Assign me/ })).not.toBeInTheDocument();
  const people = await within(popover).findByRole("group", { name: "People who can be assigned" });
  expect(within(people).getByRole("option", { name: /krister/ })).toHaveAttribute("data-checked", "true");
  fireEvent.click(within(people).getByRole("option", { name: /example-dev/ }));
  await waitFor(() => expect(assigning.assign).toHaveBeenCalledWith(55, { logins: ["krister", "example-dev"] }));
});

test("a failed assignment says why and keeps the popover open", async () => {
  const assigning = control();
  vi.mocked(assigning.assign).mockResolvedValueOnce({ ok: false, error: "ghost cannot be assigned in o/r." });
  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(assigning) });
  fireEvent.click(within(row(/Task #57/)).getByRole("button", { name: "Assign #57" }));
  const popover = await screen.findByRole("dialog", { name: "Assign #57" });
  fireEvent.click(await within(popover).findByRole("option", { name: /example-dev/ }));
  expect(await within(popover).findByText("ghost cannot be assigned in o/r.")).toBeInTheDocument();
  expect(router.refresh).not.toHaveBeenCalled();
});

test("without a token user there is no Assign me, and without a way to assign the initials only show who is assigned", async () => {
  const { unmount } = render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(control({})) });
  fireEvent.click(within(row(/Task #57/)).getByRole("button", { name: "Assign #57" }));
  const popover = await screen.findByRole("dialog", { name: "Assign #57" });
  await within(popover).findByRole("group", { name: "People who can be assigned" });
  expect(within(popover).queryByRole("option", { name: /Assign me/ })).not.toBeInTheDocument();
  unmount();

  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(undefined) });
  expect(within(row(/Task #57/)).queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();
  expect(within(row(/Task #55/)).queryByRole("button", { name: /Assignee/ })).not.toBeInTheDocument();
  expect(within(row(/Task #55/)).getByTitle("Assigned to krister")).toHaveTextContent("KR");
});

test("board cards carry the same control", () => {
  const view = planView(epics);
  render(<PlanBoard {...base} project={PROJECT} board={view.board} epics={view.epics} now={Date.parse("2026-10-02T12:00:00Z")} />, { wrapper: wrap(control()) });
  const card = within(screen.getByRole("region", { name: "Shaping" })).getByRole("listitem", { name: /#57/ });
  expect(within(card).getByRole("button", { name: "Assign #57" })).toBeInTheDocument();
  const running = within(screen.getByRole("region", { name: "Running" })).getByRole("listitem", { name: /#55/ });
  expect(within(running).getByRole("button", { name: "Assignee: krister. Change" })).toHaveTextContent("KR");
});

test("assignees show their GitHub avatars, with the login as the image's text and in the tooltip, and their initials without an avatar", async () => {
  loadImages();
  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(control()) });
  const one = within(row(/Task #55/)).getByRole("button", { name: "Assignee: krister. Change" });
  expect(within(one).getByRole("img", { name: "krister" })).toHaveAttribute("src", "https://avatars.githubusercontent.com/krister");
  fireEvent.focus(one);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("krister");
  // example-dev has no avatar, so the initials stand in.
  const many = within(row(/Task #56/)).getByRole("button", { name: "Assignees: example-dev, krister. Change" });
  expect(within(many).queryByRole("img")).not.toBeInTheDocument();
  expect(many).toHaveTextContent("EX+1");

  fireEvent.click(within(row(/Task #57/)).getByRole("button", { name: "Assign #57" }));
  const people = await within(await screen.findByRole("dialog", { name: "Assign #57" })).findByRole("group", { name: "People who can be assigned" });
  expect(within(within(people).getByRole("option", { name: /krister/ })).getByRole("img", { name: "krister" })).toHaveAttribute("src", "https://avatars.githubusercontent.com/krister");
  expect(within(people).getByRole("option", { name: /example-dev/ })).toHaveTextContent("EXexample-dev");
});

test("board cards and rows without a way to assign show the avatars too", () => {
  loadImages();
  const view = planView(epics);
  const { unmount } = render(<PlanBoard {...base} project={PROJECT} board={view.board} epics={view.epics} now={Date.parse("2026-10-02T12:00:00Z")} />, { wrapper: wrap(control()) });
  const running = within(screen.getByRole("region", { name: "Running" })).getByRole("listitem", { name: /#55/ });
  expect(within(running).getByRole("img", { name: "krister" })).toHaveAttribute("src", "https://avatars.githubusercontent.com/krister");
  unmount();

  render(<PlanTree {...base} epics={epics} />, { wrapper: wrap(undefined) });
  expect(within(row(/Task #55/)).getByTitle("Assigned to krister")).toContainElement(within(row(/Task #55/)).getByRole("img", { name: "krister" }));
});
