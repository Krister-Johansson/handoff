import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { IssueLinks, PartOf } from "./issue-links";

const issues = [
  { number: 12, title: "Slugify drops digits", url: "https://github.com/o/r/issues/12" },
  { number: 14, title: "Document slugify", url: "https://github.com/o/r/issues/14" },
];

test("each linked issue links to GitHub by number, with its title", () => {
  render(<IssueLinks issues={issues} />);
  const link = screen.getByRole("link", { name: "#12 Slugify drops digits" });
  expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/12");
  expect(link).toHaveTextContent("#12");
});

test("with titles shown, the title is part of the visible text", () => {
  render(<IssueLinks issues={issues} showTitles />);
  expect(screen.getByRole("link", { name: "#14 Document slugify" })).toHaveTextContent("#14 Document slugify");
});

test("as page meta, a single issue reads as Issue and its number", () => {
  render(<IssueLinks issues={[issues[0]!]} variant="meta" />);
  expect(screen.getByRole("link", { name: "#12 Slugify drops digits" })).toHaveTextContent("Issue #12");
});

test("in a project, each issue links to its issue page, and Part of names the story and the epic it belongs to, each linking to its page", () => {
  const linked = [{ ...issues[0]!, lineage: [{ kind: "story" as const, number: 132, title: "Board interactions" }, { kind: "epic" as const, number: 121, title: "Finish Milestone 1" }] }];
  render(
    <>
      <IssueLinks issues={linked} variant="meta" projectId="p1" />
      <PartOf issues={linked} projectId="p1" />
    </>,
  );
  expect(screen.getByRole("link", { name: "#12 Slugify drops digits" })).toHaveAttribute("href", "/projects/p1/issues/12");
  expect(screen.getByText(/Part of/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "story #132 Board interactions" })).toHaveAttribute("href", "/projects/p1/issues/132");
  expect(screen.getByRole("link", { name: "epic #121 Finish Milestone 1" })).toHaveAttribute("href", "/projects/p1/issues/121");
});

test("an issue outside any story or epic has no Part of line", () => {
  const { container } = render(<PartOf issues={issues} projectId="p1" />);
  expect(container).toBeEmptyDOMElement();
});

test("no issues renders nothing", () => {
  const { container } = render(<IssueLinks issues={[]} />);
  expect(container).toBeEmptyDOMElement();
});
