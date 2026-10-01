import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { PageHeader } from "./page-header";

test("the header shows where you are as a trail of links, the page title, its description and actions", () => {
  render(
    <PageHeader
      crumbs={[{ label: "Projects", href: "/projects" }, { label: "todooverkill", href: "/projects/p1" }, { label: "Runs" }]}
      title="Runs"
      description="Every run of this project."
      actions={<button type="button">New run</button>}
    />,
  );
  const trail = screen.getByRole("navigation", { name: "breadcrumb" });
  expect(within(trail).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
  expect(within(trail).getByRole("link", { name: "todooverkill" })).toHaveAttribute("href", "/projects/p1");
  expect(within(trail).getByText("Runs")).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { level: 1, name: "Runs" })).toBeInTheDocument();
  expect(screen.getByText("Every run of this project.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New run" })).toBeInTheDocument();
});

test("a crumb with siblings opens a menu to switch to one of them", () => {
  render(
    <PageHeader
      crumbs={[
        { label: "Projects", href: "/projects" },
        {
          label: "todooverkill",
          href: "/projects/p1",
          menu: [
            { label: "todooverkill", href: "/projects/p1", current: true },
            { label: "sandbox", href: "/projects/p2" },
          ],
        },
      ]}
      title="todooverkill"
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Switch from todooverkill" }), { key: "Enter" });
  expect(screen.getByRole("menuitem", { name: "sandbox" })).toHaveAttribute("href", "/projects/p2");
});
