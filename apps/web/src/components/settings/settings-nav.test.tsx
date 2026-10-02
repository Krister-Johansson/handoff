import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SettingsNav } from "./settings-nav";

test("the side navigation links every section by ?tab= and marks the open one", () => {
  render(<SettingsNav active="notifications" />);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const links = within(nav).getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["Appearance", "/settings?tab=appearance"],
    ["Notifications", "/settings?tab=notifications"],
    ["Claude Code", "/settings?tab=agents"],
    ["Assistant", "/settings?tab=assistant"],
    ["Worker", "/settings?tab=worker"],
  ]);
  expect(within(nav).getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Appearance" })).not.toHaveAttribute("aria-current");
  expect(within(nav).getByText("Integrations")).toBeInTheDocument();
});
