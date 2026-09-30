import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PullRequestList } from "./pr-list";

const base = { repo: "octo/sample", branch: "handoff/x", url: "https://github.com/octo/sample/pull/7", runId: "r1", runStatus: "waiting" };

test("a PR row shows number, branch, diff size and CI state", () => {
  render(<PullRequestList items={[{ ...base, number: 7, title: "Add a changelog", state: "open", ci: "failure", review: "none", additions: 12, deletions: 3 }]} />);
  expect(screen.getByText("#7")).toBeInTheDocument();
  expect(screen.getByText("handoff/x")).toBeInTheDocument();
  expect(screen.getByText("+12")).toBeInTheDocument();
  expect(screen.getByText("-3")).toBeInTheDocument();
  expect(screen.getByLabelText("CI failing")).toBeInTheDocument();
});

test("a PR without live GitHub data still lists what handoff knows", () => {
  render(<PullRequestList items={[{ ...base, number: 8, state: "unknown", ci: "unknown", review: "unknown" }]} />);
  expect(screen.getByText("#8")).toBeInTheDocument();
  expect(screen.getByLabelText("CI unknown")).toBeInTheDocument();
});

test("an empty list says so", () => {
  render(<PullRequestList items={[]} />);
  expect(screen.getByText(/no pull requests/i)).toBeInTheDocument();
});

test("a PR row shows the task and the issues its run is linked to", () => {
  render(
    <PullRequestList
      items={[
        {
          ...base,
          number: 9,
          title: "Fix slugify",
          task: "Keep digits when slugifying",
          issues: [{ number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12" }],
          state: "open",
          ci: "success",
          review: "none",
        },
      ]}
    />,
  );
  expect(screen.getByText("Keep digits when slugifying")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "#12 Slugify drops digits" })).toHaveAttribute("href", "https://github.com/octo/sample/issues/12");
});
