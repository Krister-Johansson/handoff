import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PlanTree } from "./plan-tree";
import { Sizing } from "./plan-context";
import { epic, REPO_URL, run, sizingOf, story, task, unplannedIssue } from "./testing/plan-fixtures";

const actions = vi.hoisted(() => ({
  moveToReadyAction: vi.fn(async () => ({ ok: true })),
  moveToShapingAction: vi.fn(async () => ({ ok: true })),
  planIssueAction: vi.fn(async () => ({ ok: true })),
  startRunAction: vi.fn(async () => ({})),
  listIssuesAction: vi.fn(async () => ({ issues: [] })),
}));
vi.mock("@/app/projects/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const base = { projectId: "p1", repoUrl: REPO_URL, needsYou: [] as string[], graphs: ["loop"], graphName: "loop", unparented: [], unplanned: [] };

const row = (name: RegExp) => screen.getByRole("treeitem", { name });

test("the tree shows epics with their progress, stories under them and tasks with a status pill, a run link and a PR link", () => {
  const epics = [
    epic(12, "Project management", [
      story(40, "Read the plan from GitHub", 12, [
        task(52, "Projects port", "Done", { state: "closed", run: run("r1", "succeeded", 81) }),
        task(53, "Plan read model", "In review", { run: run("r2", "waiting", 84) }),
      ]),
      story(41, "Shaping with the assistant", 12, [task(57, "Add the migration", "Shaping")]),
    ]),
  ];
  render(<PlanTree {...base} epics={epics} />);

  const epicRow = row(/Epic #12 Project management/);
  expect(epicRow).toHaveAttribute("aria-level", "1");
  expect(within(epicRow).getByText("1 of 3 done")).toBeInTheDocument();
  expect(row(/Story #40 Read the plan from GitHub/)).toHaveAttribute("aria-level", "2");
  expect(within(row(/Story #40/)).getByText("1 of 2 done")).toBeInTheDocument();

  const done = row(/Task #52 Projects port/);
  expect(done).toHaveAttribute("aria-level", "3");
  expect(within(done).getByText("Done")).toBeInTheDocument();
  expect(within(done).getByRole("link", { name: "#52 Projects port" })).toHaveAttribute("href", `${REPO_URL}/issues/52`);
  expect(within(done).getByRole("link", { name: /succeeded/ })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(within(done).getByRole("link", { name: "PR #81" })).toHaveAttribute("href", `${REPO_URL}/pull/81`);

  const review = row(/Task #53/);
  expect(within(review).getByText("In review")).toBeInTheDocument();
  expect(within(review).getByRole("link", { name: /waiting/ })).toHaveAttribute("href", "/projects/p1/runs/r2");
  expect(within(row(/Task #57/)).getByText("Shaping")).toBeInTheDocument();
  expect(within(row(/Task #57/)).queryByRole("link", { name: /PR/ })).not.toBeInTheDocument();
});

test("a blocked task shows its blockers and a task whose run needs a person links to the inbox for the project", () => {
  const epics = [
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(56, "Approval cards", "Running", { run: run("r6", "waiting") }),
        task(57, "Add the migration", "Shaping", { blockedBy: [55, 54] }),
      ]),
    ]),
  ];
  render(<PlanTree {...base} needsYou={["r6"]} epics={epics} />);

  const blocked = row(/Task #57/);
  expect(within(blocked).getByText(/Blocked by/)).toBeInTheDocument();
  expect(within(blocked).getByRole("link", { name: "#55" })).toHaveAttribute("href", `${REPO_URL}/issues/55`);
  expect(within(blocked).getByRole("link", { name: "#54" })).toHaveAttribute("href", `${REPO_URL}/issues/54`);
  expect(within(row(/Story #41/)).getByText("Blocked")).toBeInTheDocument();

  const waiting = row(/Task #56/);
  expect(within(waiting).getByRole("link", { name: "Needs you" })).toHaveAttribute("href", "/inbox?project=p1");
  expect(within(waiting).queryByRole("link", { name: /waiting/ })).not.toBeInTheDocument();
});

test("Move to Ready appears only in Shaping and Back to Shaping only in Ready, each behind a confirm dialog that names the task", async () => {
  const epics = [
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { run: run("r5", "running") }),
        task(57, "Add the migration", "Shaping", { blockedBy: [55] }),
        task(58, "Plan page tree and board", "Ready"),
      ]),
    ]),
  ];
  render(<PlanTree {...base} epics={epics} />);

  expect(within(row(/Task #55/)).queryByRole("button", { name: /Move to Ready|Back to Shaping/ })).not.toBeInTheDocument();
  expect(within(row(/Task #57/)).queryByRole("button", { name: "Back to Shaping" })).not.toBeInTheDocument();
  expect(within(row(/Task #58/)).queryByRole("button", { name: "Move to Ready" })).not.toBeInTheDocument();
  expect(within(row(/Task #58/)).getByRole("button", { name: "Start run" })).toBeInTheDocument();

  fireEvent.click(within(row(/Task #57/)).getByRole("button", { name: "Move to Ready" }));
  const ready = await screen.findByRole("alertdialog", { name: "Move #57 Add the migration to Ready?" });
  expect(within(ready).getByText(/blocked by #55/)).toBeInTheDocument();
  fireEvent.click(within(ready).getByRole("button", { name: "Move to Ready" }));
  await waitFor(() => expect(actions.moveToReadyAction).toHaveBeenCalledWith({ projectId: "p1", issue: 57 }));

  fireEvent.click(within(row(/Task #58/)).getByRole("button", { name: "Back to Shaping" }));
  const shaping = await screen.findByRole("alertdialog", { name: "Move #58 Plan page tree and board back to Shaping?" });
  fireEvent.click(within(shaping).getByRole("button", { name: "Cancel" }));
  expect(actions.moveToShapingAction).not.toHaveBeenCalled();
  fireEvent.click(within(row(/Task #58/)).getByRole("button", { name: "Back to Shaping" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Back to Shaping" }));
  await waitFor(() => expect(actions.moveToShapingAction).toHaveBeenCalledWith({ projectId: "p1", issue: 58 }));
});

test("an issue without a kind label and an unparented issue say so", () => {
  const epics = [epic(12, "Project management", [story(42, "Parent context", 12, [task(59, "Part of section", "Done", { labels: ["enhancement"], state: "closed" })])])];
  const unparented = [task(61, "Rate limit back-off", "Shaping", { parent: 34 }), task(62, "Loose task", "Ready")];
  render(<PlanTree {...base} epics={epics} unparented={unparented} />);

  expect(within(row(/Task #59/)).getByText("no kind label")).toBeInTheDocument();
  expect(within(row(/Task #61/)).queryByText("no kind label")).not.toBeInTheDocument();

  const block = screen.getByRole("treeitem", { name: /^Unparented/ });
  expect(within(block).getByText("parent #34 is not in the plan")).toBeInTheDocument();
  expect(within(row(/Task #61/)).getByRole("button", { name: "Move to Ready" })).toBeInTheDocument();
  expect(within(row(/Task #62/)).queryByText(/is not in the plan/)).not.toBeInTheDocument();
});

test("the tree is one tab stop: arrows move between rows, Left collapses an epic and Right opens it again", () => {
  localStorage.clear();
  const epics = [epic(12, "Project management", [story(41, "Shaping", 12, [task(57, "Add the migration", "Shaping")])]), epic(10, "Voice", [])];
  render(<PlanTree {...base} epics={epics} />);
  const top = row(/Epic #12/);
  expect(top).toHaveAttribute("tabindex", "0");
  expect(row(/Story #41/)).toHaveAttribute("tabindex", "-1");

  top.focus();
  fireEvent.keyDown(top, { key: "ArrowDown" });
  expect(row(/Story #41/)).toHaveFocus();
  expect(row(/Story #41/)).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(row(/Story #41/), { key: "ArrowLeft" });
  expect(row(/Story #41/)).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("treeitem", { name: /Task #57/ })).not.toBeInTheDocument();
  fireEvent.keyDown(row(/Story #41/), { key: "ArrowLeft" });
  expect(top).toHaveFocus();
  fireEvent.keyDown(top, { key: "ArrowLeft" });
  expect(top).toHaveAttribute("aria-expanded", "false");
  fireEvent.keyDown(top, { key: "ArrowDown" });
  expect(row(/Epic #10/)).toHaveFocus();
  fireEvent.keyDown(row(/Epic #10/), { key: "Home" });
  fireEvent.keyDown(top, { key: "ArrowRight" });
  expect(top).toHaveAttribute("aria-expanded", "true");
  expect(row(/Story #41/)).toHaveAttribute("aria-expanded", "false");
  localStorage.clear();
});

test("a task whose status write was skipped says so, with the reason on hover", () => {
  const epics = [epic(12, "Project management", [story(41, "Shaping", 12, [task(57, "Add the migration", "Ready", { run: run("r7", "running") })])])];
  render(<PlanTree {...base} epics={epics} skipped={{ 57: "#57 not moved to Running: not in the plan's Project" }} />);
  expect(within(row(/Task #57/)).getByText("Status not written").closest("[title]")).toHaveAttribute("title", "#57 not moved to Running: not in the plan's Project");
  expect(within(row(/Task #57/)).getByText("Run active")).toBeInTheDocument();
});

test("a candidate task shows its Next tag", () => {
  const epics = [epic(12, "Project management", [story(41, "Shaping", 12, [task(66, "First", "Ready"), task(67, "Second", "Ready"), task(68, "Not next", "Ready")])])];
  render(<PlanTree {...base} epics={epics} next={{ 66: 1, 67: 2 }} />);
  expect(within(row(/Task #66/)).getByText("Next 1").closest("[title]")).toHaveAttribute("title", "The scheduler starts it next");
  expect(within(row(/Task #67/)).getByText("Next 2").closest("[title]")).toHaveAttribute("title", "The scheduler starts it second");
  expect(within(row(/Task #68/)).queryByText(/^Next/)).not.toBeInTheDocument();
});

test("a task whose Status disagrees with its active run says what the run is doing", () => {
  const epics = [
    epic(12, "Project management", [
      story(41, "Shaping", 12, [
        task(16, "Added during its run", "Shaping", { run: run("64fde8ef", "running") }),
        task(17, "Dragged back", "Ready", { run: run("r17", "waiting", 88) }),
        task(18, "Agrees", "Running", { run: run("r18", "running") }),
        task(19, "In review", "In review", { run: run("r19", "waiting", 90) }),
        task(20, "Run ended", "Shaping", { run: run("r20", "cancelled") }),
      ]),
    ]),
  ];
  render(<PlanTree {...base} epics={epics} />);
  const note = within(row(/Task #16/)).getByText("run running");
  expect(note.closest("[title]")).toHaveAttribute("title", "Status says Shaping, but its run is running. handoff sets Running while a run works on a task.");
  expect(within(row(/Task #17/)).getByText("run in review").closest("[title]")).toHaveAttribute(
    "title",
    "Status says Ready, but its run is waiting with PR #88 open. handoff sets In review while a run's pull request is open.",
  );
  for (const agrees of [/Task #18/, /Task #19/, /Task #20/]) expect(within(row(agrees)).queryByText(/^run /)).not.toBeInTheDocument();
});

test("unplanned issues sit in their own block, stay startable, and Plan it adds one as a task under an optional story", async () => {
  const epics = [epic(12, "Project management", [story(41, "Shaping with the assistant", 12, [task(57, "Add the migration", "Shaping")])])];
  render(<PlanTree {...base} epics={epics} unplanned={[unplannedIssue(301, "Worker restarts while a run is active")]} />);
  const block = screen.getByRole("treeitem", { name: /^Unplanned/ });
  expect(within(block).getByText("Open issues outside the plan. They stay startable.")).toBeInTheDocument();
  const issue = row(/Issue #301 Worker restarts/);
  expect(within(issue).getByRole("link", { name: "#301 Worker restarts while a run is active" })).toHaveAttribute("href", `${REPO_URL}/issues/301`);
  expect(within(issue).getByRole("button", { name: "Start run" })).toBeInTheDocument();

  fireEvent.click(within(issue).getByRole("button", { name: "Plan it" }));
  const dialog = await screen.findByRole("dialog", { name: "Plan #301 Worker restarts while a run is active" });
  expect(within(dialog).getByText("Adds it to the plan as a task in Shaping.")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Story (optional)"), { target: { value: "41" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Plan it" }));
  await waitFor(() => expect(actions.planIssueAction).toHaveBeenCalledWith({ projectId: "p1", issue: 301, story: 41 }));
});

test("task rows carry their size chip and story and epic rows the sum of their tasks", () => {
  const epics = [
    epic(120, "Refined product redesign", [
      story(127, "Restyle project views", 120, [
        task(145, "R5 Restyle board columns", "Shaping", { size: "M" }),
        task(147, "R7 Restyle the dashboard", "Shaping", { proposal: { size: "M", runId: "r9", steps: 6, paths: 4 } }),
        task(152, "Document the workflow", "Shaping"),
      ]),
    ]),
  ];
  render(
    <Sizing value={sizingOf()}>
      <PlanTree {...base} epics={epics} />
    </Sizing>,
  );
  expect(within(row(/Task #145/)).getByRole("button", { name: "Size M, forecast 50m. Change the size or estimate of #145" })).toBeInTheDocument();
  expect(within(row(/Task #152/)).getByRole("button", { name: "Set a size for #152" })).toBeInTheDocument();
  expect(within(row(/Story #127/)).getByTitle("1 hour 40 minutes over 2 tasks, forecasts; #152 has no size")).toHaveTextContent(/^~1h 40m\+1$/);
  expect(within(row(/Epic #120/)).getAllByTitle(/over 2 tasks/)[0]).toHaveTextContent(/^~1h 40m\+1$/);
});

test("in a Flow project story and epic rows count their tasks' sizes instead of summing times", () => {
  const epics = [
    epic(120, "Refined product redesign", [
      story(127, "Restyle project views", 120, [
        task(145, "R5 Restyle board columns", "Shaping", { size: "M" }),
        task(146, "R6 Restyle the list view", "Shaping", { size: "S", estimate: 9 }),
        task(144, "R4 Restyle the content", "Shaping", { size: "S" }),
        task(147, "R7 Restyle the dashboard", "Shaping", { proposal: { size: "M", runId: "r9", steps: 6, paths: 4 } }),
      ]),
      story(128, "Unsized work", 120, [task(152, "Document the workflow", "Shaping"), task(153, "Write the guide", "Shaping", { estimate: 3 })]),
    ]),
  ];
  render(
    <Sizing value={sizingOf({ mode: "flow" })}>
      <PlanTree {...base} epics={epics} />
    </Sizing>,
  );
  expect(within(row(/Story #127/)).getByTitle("4 tasks: 2 S, 1 M, 1 unsized")).toHaveTextContent(/^2 S, 1 M, 1 unsized$/);
  expect(within(row(/Epic #120/)).getAllByTitle(/^6 tasks/)[0]).toHaveTextContent(/^2 S, 1 M, 3 unsized$/);
  expect(within(row(/Story #128/)).queryByTitle(/tasks/)).not.toBeInTheDocument();
  expect(row(/Story #128/).textContent).not.toMatch(/unsized|\d+(m|h|d)\b/);
  expect(row(/Story #127/).textContent).not.toMatch(/~|\d+(m|h|d)\b/);
});
