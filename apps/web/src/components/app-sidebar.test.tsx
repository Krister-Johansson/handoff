import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar, type SidebarProject } from "./app-sidebar";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const PROJECTS: SidebarProject[] = [
  { id: "p1", name: "handoff", repo: "Krister-Johansson/handoff", activeRuns: 2 },
  { id: "p2", name: "example-shop", repo: "example-org/example-shop", activeRuns: 0 },
  { id: "p3", name: "demo-docs", repo: "example-org/demo-docs", activeRuns: 0 },
];

function renderSidebar({ pathname, open = true, lastProjectId, inboxCount = 0 }: { pathname: string; open?: boolean; lastProjectId?: string; inboxCount?: number }) {
  nav.pathname = pathname;
  return render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar projects={PROJECTS} lastProjectId={lastProjectId} inboxCount={inboxCount} worker={{ live: 1, queuedRuns: 0 }} />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

const links = (nav: HTMLElement) => within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);
const current = () => screen.queryAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent);

beforeEach(() => {
  document.cookie = "handoff_last_project=; path=/; max-age=0";
});

test("the project group links to each project route and marks the current one", () => {
  renderSidebar({ pathname: "/projects/p1/issues" });
  const project = screen.getByRole("navigation", { name: "Project" });
  expect(links(project)).toEqual([
    ["Overview", "/projects/p1"],
    ["Runs", "/projects/p1/runs"],
    ["Plan", "/projects/p1/plan"],
    ["Issues", "/projects/p1/issues"],
    ["Pull requests", "/projects/p1/pulls"],
    ["Graphs", "/projects/p1/graphs"],
    ["Project settings", "/projects/p1/settings"],
  ]);
  expect(current()).toEqual(["Issues"]);
  // Runs counts the project's active runs.
  expect(within(project).getByText("2")).toBeInTheDocument();
  expect(links(screen.getByRole("navigation", { name: "All projects" }))).toEqual([
    ["Inbox", "/inbox"],
    ["Library", "/library"],
  ]);

  // The Plan page and a run page mark their items too.
  // The project's own address is its Overview.
  for (const [pathname, item] of [
    ["/projects/p1", "Overview"],
    ["/projects/p1/plan", "Plan"],
    ["/projects/p1/runs/r1", "Runs"],
  ] as const) {
    cleanup();
    renderSidebar({ pathname });
    expect(current()).toEqual([item]);
  }
});

test("outside a project the switcher shows the last project from the cookie", () => {
  const { unmount } = renderSidebar({ pathname: "/projects/p2/graphs" });
  expect(document.cookie).toContain("handoff_last_project=p2");
  unmount();

  renderSidebar({ pathname: "/inbox", lastProjectId: "p2" });
  expect(screen.getByRole("button", { name: "Project: example-shop. Switch project" })).toBeInTheDocument();
  expect(links(screen.getByRole("navigation", { name: "Project" }))[0]).toEqual(["Overview", "/projects/p2"]);
  expect(current()).toEqual(["Inbox"]);
});

test("without a project used last, the switcher shows the first project; without projects it offers to add one", () => {
  const { unmount } = renderSidebar({ pathname: "/settings" });
  expect(screen.getByRole("button", { name: "Project: handoff. Switch project" })).toBeInTheDocument();
  unmount();

  nav.pathname = "/settings";
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar projects={[]} inboxCount={0} worker={{ live: 0, queuedRuns: 0 }} />
      </SidebarProvider>
    </TooltipProvider>,
  );
  expect(screen.queryByRole("navigation", { name: "Project" })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "No project yet. Add one" }), { key: "Enter" });
  expect(screen.getByRole("menuitem", { name: "Add project" })).toHaveAttribute("href", "/settings?tab=projects&add=1");
});

/** The text a screen reader reads, without the decorative letter tiles. */
const spoken = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((n) => n.remove());
  return copy.textContent;
};

const openSwitcher = (name: RegExp) => {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((i) => [spoken(i), i.getAttribute("href")]);
};

test("picking another project keeps the page type", () => {
  const { unmount } = renderSidebar({ pathname: "/projects/p1/plan" });
  expect(openSwitcher(/^Project: handoff/)).toEqual([
    ["example-shopexample-org/example-shop", "/projects/p2/plan"],
    ["demo-docsexample-org/demo-docs", "/projects/p3/plan"],
    ["Add project", "/settings?tab=projects&add=1"],
    ["Manage projects", "/settings?tab=projects"],
  ]);
  unmount();

  // From a run, the other project's runs; from outside a project, its Overview.
  const run = renderSidebar({ pathname: "/projects/p1/runs/r1" });
  expect(openSwitcher(/^Project: handoff/)[0]).toEqual(["example-shopexample-org/example-shop", "/projects/p2/runs"]);
  run.unmount();
  renderSidebar({ pathname: "/library", lastProjectId: "p1" });
  expect(openSwitcher(/^Project: handoff/)[0]).toEqual(["example-shopexample-org/example-shop", "/projects/p2"]);
});

test("collapsed, Inbox shows a dot when it has items", () => {
  const { unmount } = renderSidebar({ pathname: "/library", open: false, inboxCount: 6 });
  expect(screen.getByRole("link", { name: "Inbox, 6 waiting" })).toBeInTheDocument();
  expect(screen.getByTestId("inbox-dot")).toBeInTheDocument();
  unmount();

  renderSidebar({ pathname: "/library", open: false, inboxCount: 0 });
  expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
  expect(screen.queryByTestId("inbox-dot")).not.toBeInTheDocument();
});

