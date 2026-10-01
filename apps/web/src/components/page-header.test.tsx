import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PageHeader } from "./page-header";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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

test("a crumb with siblings opens a searchable list to switch to one of them", () => {
  render(
    <PageHeader
      crumbs={[
        { label: "Projects", href: "/projects" },
        {
          label: "todooverkill",
          href: "/projects/p1",
          menuLabel: "projects",
          menu: [
            { label: "todooverkill", href: "/projects/p1", current: true },
            { label: "sandbox", href: "/projects/p2" },
            { label: "demo", href: "/projects/p3" },
          ],
        },
      ]}
      title="todooverkill"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Switch from todooverkill" }));
  const search = screen.getByPlaceholderText("Search projects");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["todooverkill", "sandbox", "demo"]);
  fireEvent.change(search, { target: { value: "sand" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["sandbox"]);
  fireEvent.click(screen.getByRole("option", { name: "sandbox" }));
  expect(push).toHaveBeenCalledWith("/projects/p2");
});

test("a run in the list shows its status", () => {
  render(
    <PageHeader
      crumbs={[{ label: "#3 F03 Prisma", href: "/projects/p1/runs/r3", menuLabel: "runs", menu: [{ label: "#3 F03 Prisma", href: "/projects/p1/runs/r3", current: true, status: "succeeded" }] }]}
      title="#3 F03 Prisma"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Switch from #3 F03 Prisma" }));
  expect(within(screen.getByRole("option")).getByText("succeeded")).toBeInTheDocument();
});
