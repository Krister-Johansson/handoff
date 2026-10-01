import { expect, test } from "vitest";
import { acceptanceOf, criteriaInIssue } from "./acceptance.ts";
import { PlannerOutputSchema } from "./schema/outputs.ts";
import { initialRunState } from "./schema/run-state.ts";

const issue = (number: number, body: string) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}`, body });

test("an issue's acceptance criteria are the checkboxes under its acceptance heading", () => {
  const body = [
    "Add a board view.",
    "",
    "## Tasks",
    "- [ ] Add the route",
    "",
    "## Acceptance criteria",
    "- [ ] A user can create a new task",
    "* [x] Tasks show in **columns** by status",
    "  - [ ] Nested items count too",
    "",
    "## Notes",
    "- [ ] Not a criterion",
  ].join("\n");
  expect(criteriaInIssue(body)).toEqual(["A user can create a new task", "Tasks show in columns by status", "Nested items count too"]);
});

test("without an acceptance heading, every checkbox in the issue is a criterion", () => {
  expect(criteriaInIssue("Do it.\n\n- [ ] Users can sign in\n- [X] Sessions expire after a day")).toEqual(["Users can sign in", "Sessions expire after a day"]);
  expect(criteriaInIssue("Just prose, and a plain list:\n- one\n- two")).toEqual([]);
});

test("a run's criteria come from its issues first, then from the planner", () => {
  const withIssues = initialRunState("t", [issue(5, "- [ ] A user can create a new task"), issue(6, "## Definition of done\n- [ ] Tasks persist")]);
  expect(acceptanceOf({ ...withIssues, plan: { plan: "p", steps: [], ownedPaths: [], acceptance: ["Planner's own"] } })).toEqual({
    source: "issue",
    items: ["A user can create a new task", "Tasks persist"],
  });
  const planned = { ...initialRunState("t", [issue(5, "No boxes")]), plan: { plan: "p", steps: [], ownedPaths: [], acceptance: ["A user can create a new task"] } };
  expect(acceptanceOf(planned)).toEqual({ source: "planner", items: ["A user can create a new task"] });
  expect(acceptanceOf(initialRunState("t"))).toBeUndefined();
});

test("a planner may list acceptance criteria", () => {
  expect(PlannerOutputSchema.parse({ plan: "p", steps: [], ownedPaths: [], acceptance: ["A user can create a new task"] }).acceptance).toEqual(["A user can create a new task"]);
});
