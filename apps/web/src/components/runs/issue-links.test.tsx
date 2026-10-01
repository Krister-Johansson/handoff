import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { IssueLinks } from "./issue-links";

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

test("no issues renders nothing", () => {
  const { container } = render(<IssueLinks issues={[]} />);
  expect(container).toBeEmptyDOMElement();
});
