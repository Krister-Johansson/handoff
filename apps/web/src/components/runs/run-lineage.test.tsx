import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { RunLineage } from "./run-lineage";

test("a run links to the run it continues and to the run started again in its place", () => {
  render(<RunLineage projectId="p1" continues="0a1b2c3d-0000-0000-0000-000000000000" supersededBy="9f8e7d6c-0000-0000-0000-000000000000" />);
  expect(screen.getByRole("link", { name: "continues run 0a1b2c3d" })).toHaveAttribute("href", "/projects/p1/runs/0a1b2c3d-0000-0000-0000-000000000000");
  expect(screen.getByRole("link", { name: "superseded by run 9f8e7d6c" })).toHaveAttribute("href", "/projects/p1/runs/9f8e7d6c-0000-0000-0000-000000000000");
});

test("a run that was never run again shows no links", () => {
  const { container } = render(<RunLineage projectId="p1" continues={null} supersededBy={null} />);
  expect(container).toBeEmptyDOMElement();
});
