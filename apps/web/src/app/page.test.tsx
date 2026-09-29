import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("home page links to runs", () => {
  render(<Home />);
  expect(screen.getByRole("link", { name: /runs/i })).toHaveAttribute("href", "/runs");
});
