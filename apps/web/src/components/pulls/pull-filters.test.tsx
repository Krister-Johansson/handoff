import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { parsePullFilter } from "@/lib/pull-filter";
import { ArchivePullButton, PullFilters } from "./pull-filters";

const actions = vi.hoisted(() => ({
  archivePullAction: vi.fn(async () => ({ ok: true })),
  unarchivePullAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

test("parsePullFilter defaults to open and ignores unknown values", () => {
  expect(parsePullFilter({})).toBe("open");
  expect(parsePullFilter({ pr: "archived" })).toBe("archived");
  expect(parsePullFilter({ pr: "bogus" })).toBe("open");
});

test("the filters link to each state with their counts and mark the current one", () => {
  render(<PullFilters active="open" counts={{ open: 1, merged: 6, closed: 0, all: 7, archived: 2 }} />);
  expect(screen.getByRole("link", { name: "Open 1" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Merged 6" })).toHaveAttribute("href", "?pr=merged");
  expect(screen.getByRole("link", { name: "Archived 2" })).toHaveAttribute("href", "?pr=archived");
});

test("archiving and unarchiving send the run", async () => {
  const { unmount } = render(<ArchivePullButton runId="r1" number={7} archived={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Archive #7" }));
  await waitFor(() => expect(actions.archivePullAction).toHaveBeenCalledTimes(1));
  expect(((actions.archivePullAction.mock.calls[0] as unknown[])[1] as FormData).get("runId")).toBe("r1");
  unmount();
  render(<ArchivePullButton runId="r1" number={7} archived />);
  fireEvent.click(screen.getByRole("button", { name: "Unarchive #7" }));
  await waitFor(() => expect(actions.unarchivePullAction).toHaveBeenCalledTimes(1));
});
