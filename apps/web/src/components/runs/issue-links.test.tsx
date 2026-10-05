import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { IssueLinks, PartOf } from "./issue-links";
import { UnlinkIssueButton } from "./unlink-issue-button";

const unlinkIssueAction = vi.hoisted(() => vi.fn(async (): Promise<{ ok?: boolean; error?: string }> => ({ ok: true })));
vi.mock("@/app/inbox/actions", () => ({ unlinkIssueAction }));
beforeEach(() => unlinkIssueAction.mockClear());

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

test("on a run, each issue has an Unlink button that asks first and then takes the issue off the run", async () => {
  render(<IssueLinks issues={issues} variant="meta" projectId="p1" after={(issue) => <UnlinkIssueButton runId="r1" issue={issue} />} />);
  fireEvent.click(screen.getByRole("button", { name: "Unlink #14" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Unlink #14 Document slugify from this run?" });
  expect(dialog).toHaveTextContent("The pull request no longer closes it");
  expect(unlinkIssueAction).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
  await waitFor(() => expect(unlinkIssueAction).toHaveBeenCalledWith({ runId: "r1", issue: 14 }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

test("a refused unlink keeps the dialog open with the reason", async () => {
  unlinkIssueAction.mockResolvedValueOnce({ ok: false, error: "Pull request #9 of run r1 merged, so #12 stays linked." });
  render(<IssueLinks issues={issues} variant="meta" projectId="p1" after={(issue) => <UnlinkIssueButton runId="r1" issue={issue} />} />);
  fireEvent.click(screen.getByRole("button", { name: "Unlink #12" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
  expect(await within(dialog).findByText("Pull request #9 of run r1 merged, so #12 stays linked.")).toBeInTheDocument();
});

test("without a control after each issue, issue links have no Unlink button", () => {
  render(<IssueLinks issues={issues} variant="meta" projectId="p1" />);
  expect(screen.queryByRole("button", { name: /Unlink/ })).not.toBeInTheDocument();
});
