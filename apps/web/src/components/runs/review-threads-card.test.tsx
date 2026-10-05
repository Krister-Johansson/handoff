import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ReviewThreadsCard } from "./review-threads-card";

const thread = (path: string, line: number | null, over: Partial<{ outdated: boolean; author: string; body: string }> = {}) => ({
  path,
  line,
  outdated: false,
  author: "coderabbitai",
  body: "Handle the empty list.",
  url: `https://github.com/octo/sample/pull/9#${path}`,
  ...over,
});

test("the card names each unresolved thread with a link to it, and links to the pull request", () => {
  render(<ReviewThreadsCard number={9} url="https://github.com/octo/sample/pull/9" threads={[thread("src/app.ts", 12), thread("README.md", null, { outdated: true, author: "octocat", body: "Say how to run it." })]} />);
  expect(screen.getByText("PR #9 has 2 unresolved review threads")).toBeInTheDocument();
  expect(screen.getByText(/A rule on the base branch requires resolved conversations/)).toBeInTheDocument();
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]!).getByRole("link", { name: "src/app.ts:12" })).toHaveAttribute("href", "https://github.com/octo/sample/pull/9#src/app.ts");
  expect(within(items[0]!).getByText("coderabbitai: Handle the empty list.")).toBeInTheDocument();
  expect(within(items[1]!).getByRole("link", { name: "README.md" })).toBeInTheDocument();
  expect(within(items[1]!).getByText("outdated")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Resolve on GitHub" })).toHaveAttribute("href", "https://github.com/octo/sample/pull/9");
});

test("with review items, the card says handoff does not manage these threads and names the item a thread belongs to", () => {
  const left = thread("src/app.ts", 12);
  render(<ReviewThreadsCard number={9} url="https://github.com/octo/sample/pull/9" threads={[left, thread("README.md", 3)]} notes={{ [left.url]: "R16, left to you" }} />);
  expect(screen.getByText(/handoff does not manage these threads/)).toBeInTheDocument();
  const items = screen.getAllByRole("listitem");
  expect(within(items[0]!).getByText("R16, left to you")).toBeInTheDocument();
  expect(within(items[1]!).queryByText(/R\d+/)).not.toBeInTheDocument();
});
