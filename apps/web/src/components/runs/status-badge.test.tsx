import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StatusBadge } from "./status-badge";

test.each([
  ["succeeded", "success"],
  ["passed", "success"],
  ["running", "active"],
  ["waiting", "attention"],
  ["queued", "neutral"],
  ["pending", "neutral"],
  ["failed", "danger"],
  ["cancelled", "muted"],
  ["repaired", "repaired"],
])("a %s status reads as %s", (status, tone) => {
  render(<StatusBadge status={status} />);
  expect(screen.getByText(status)).toHaveAttribute("data-tone", tone);
});

test("an unknown status is neutral", () => {
  render(<StatusBadge status="mystery" />);
  expect(screen.getByText("mystery")).toHaveAttribute("data-tone", "neutral");
});
