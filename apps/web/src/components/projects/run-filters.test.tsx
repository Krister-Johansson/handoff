import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { RunFilters } from "./run-filters";

const COUNTS = { all: 9, active: 2, waiting: 1, failed: 3, done: 3 };

test("the filters link to all runs and to each status with their counts, the current one lit", () => {
  const { unmount } = render(<RunFilters projectId="p1" active={undefined} counts={COUNTS} />);
  const links = screen.getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["All 9", "/projects/p1/runs"],
    ["Active 2", "/projects/p1/runs?status=active"],
    ["Waiting 1", "/projects/p1/runs?status=waiting"],
    ["Failed 3", "/projects/p1/runs?status=failed"],
    ["Done 3", "/projects/p1/runs?status=done"],
  ]);
  expect(screen.getByRole("link", { name: "All 9" })).toHaveAttribute("aria-current", "page");
  unmount();

  render(<RunFilters projectId="p1" active="waiting" counts={COUNTS} />);
  expect(screen.getByRole("link", { name: "Waiting 1" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "All 9" })).not.toHaveAttribute("aria-current");
});
