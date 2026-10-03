import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import { AppSidebar, type SidebarProject } from "./app-sidebar";
import { SidebarSection, SidebarSectionProvider } from "./sidebar-section";

/** The address the sidebar reads: the path and the query. */
const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.search) }));

/** Goes to an address such as /projects/p1/runs?status=waiting. */
const goTo = (url: string) => {
  const [pathname, search = ""] = url.split("?");
  nav.pathname = pathname!;
  nav.search = search;
};

// handoff plans in Flow and has 3 runs on the go, 1 of them waiting; example-shop plans in Timeline.
const PROJECTS: SidebarProject[] = [
  { id: "p1", name: "handoff", repo: "Krister-Johansson/handoff", planMode: "flow", activeRuns: 3, waitingRuns: 1 },
  { id: "p2", name: "example-shop", repo: "example-org/example-shop", planMode: "timeline", activeRuns: 0, waitingRuns: 0 },
  { id: "p3", name: "demo-docs", repo: "example-org/demo-docs", planMode: "flow", activeRuns: 0, waitingRuns: 0 },
];

function renderSidebar({ pathname, open = true, lastProjectId, inboxCount = 0 }: { pathname: string; open?: boolean; lastProjectId?: string; inboxCount?: number }) {
  goTo(pathname);
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

test("Home and Inbox come first, then Plan with Issues and Build with Runs and Pull requests; one item is current", () => {
  renderSidebar({ pathname: "/projects/p1/issues" });
  expect(links(screen.getByRole("navigation", { name: "Home and Inbox" }))).toEqual([
    ["Home", "/projects/p1"],
    ["Inbox", "/inbox"],
  ]);
  // Neither submenu holds the Issues page, so both are closed.
  expect(links(screen.getByRole("navigation", { name: "Plan" }))).toEqual([
    ["Plan", "/projects/p1/plan"],
    ["Issues", "/projects/p1/issues"],
  ]);
  const build = screen.getByRole("navigation", { name: "Build" });
  expect(links(build)).toEqual([
    ["Runs", "/projects/p1/runs"],
    ["Pull requests", "/projects/p1/pulls"],
  ]);
  expect(current()).toEqual(["Issues"]);
  // With its submenu closed, Runs counts the project's queued, running and waiting runs.
  expect(within(build).getByRole("link", { name: "Runs, 3 active" })).toBeInTheDocument();
  expect(within(build).getByText("3")).toBeInTheDocument();
  // Graphs is in Project settings and the library in Settings, so neither has an item of its own.
  expect(screen.queryByRole("link", { name: "Graphs" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Library" })).not.toBeInTheDocument();

  // The project's own address is its Home. A library entry belongs to Settings.
  for (const [pathname, item] of [
    ["/projects/p1", "Home"],
    ["/projects/p1/pulls", "Pull requests"],
    ["/library/skills/tdd", "Settings"],
  ] as const) {
    cleanup();
    renderSidebar({ pathname });
    expect(current()).toEqual([item]);
  }
});

const submenu = (name: string) => screen.queryByRole("list", { name });
const toggle = (name: string) => screen.getByRole("button", { name });

test("on the Plan page the Plan submenu is open with the plan mode's view first, and the view on screen is current", () => {
  renderSidebar({ pathname: "/projects/p1/plan" });
  expect(links(submenu("Plan views")!)).toEqual([
    ["Flow", "/projects/p1/plan?view=flow"],
    ["Board", "/projects/p1/plan?view=board"],
    ["Tree", "/projects/p1/plan?view=tree"],
  ]);
  expect(toggle("Plan views")).toHaveAttribute("aria-expanded", "true");
  // The Plan page opens the plan mode's view, so Flow is current and Plan is not.
  expect(current()).toEqual(["Flow"]);
  expect(submenu("Run filters")).not.toBeInTheDocument();
  expect(toggle("Run filters")).toHaveAttribute("aria-expanded", "false");
  cleanup();

  renderSidebar({ pathname: "/projects/p1/plan?view=tree&epic=12" });
  expect(current()).toEqual(["Tree"]);
  cleanup();

  // A Timeline project lists Timeline first; an old ?view=flow link opens its Timeline.
  renderSidebar({ pathname: "/projects/p2/plan?view=flow" });
  expect(links(submenu("Plan views")!)).toEqual([
    ["Timeline", "/projects/p2/plan?view=timeline"],
    ["Board", "/projects/p2/plan?view=board"],
    ["Tree", "/projects/p2/plan?view=tree"],
  ]);
  expect(current()).toEqual(["Timeline"]);
});

test("Runs opens on its pages: a filter is current with Active and Waiting counted, and a run page or all runs mark Runs itself", () => {
  renderSidebar({ pathname: "/projects/p1/runs?status=waiting" });
  const filters = submenu("Run filters")!;
  expect(within(filters).getAllByRole("link").map((l) => [l.getAttribute("aria-label") ?? l.textContent, l.getAttribute("href")])).toEqual([
    ["Active, 2", "/projects/p1/runs?status=active"],
    ["Waiting, 1", "/projects/p1/runs?status=waiting"],
    ["Failed", "/projects/p1/runs?status=failed"],
    ["Done", "/projects/p1/runs?status=done"],
  ]);
  expect(current()).toEqual(["Waiting1"]);
  // The open submenu counts the runs, so Runs drops its badge.
  expect(screen.getByRole("link", { name: "Runs" })).toBeInTheDocument();
  expect(submenu("Plan views")).not.toBeInTheDocument();

  for (const pathname of ["/projects/p1/runs", "/projects/p1/runs/r1", "/projects/p1/runs?status=bogus"]) {
    cleanup();
    renderSidebar({ pathname });
    expect(submenu("Run filters")).toBeInTheDocument();
    expect(current()).toEqual(["Runs"]);
  }
});

test("an issue page marked for the plan opens Plan with Plan current and no view lit", () => {
  render(withPage("/projects/p1/issues/16", <SidebarSection section="plan" />));
  expect(submenu("Plan views")).toBeInTheDocument();
  expect(current()).toEqual(["Plan"]);
});

test("the chevrons fold by hand; navigating opens the submenu of the new page and keeps one opened by hand", () => {
  const { rerender } = render(withPage("/projects/p1/plan", null));
  // Open Runs by hand on the Flow page: both are open.
  fireEvent.click(toggle("Run filters"));
  expect(submenu("Run filters")).toBeInTheDocument();
  expect(submenu("Plan views")).toBeInTheDocument();
  // Fold Plan by hand; moving to another view of the plan opens it again.
  fireEvent.click(toggle("Plan views"));
  expect(submenu("Plan views")).not.toBeInTheDocument();
  rerender(withPage("/projects/p1/plan?view=board", null));
  expect(submenu("Plan views")).toBeInTheDocument();
  expect(submenu("Run filters")).toBeInTheDocument();
  // Plan was not opened by hand, but it stays open as Runs did: neither closes on navigation.
  rerender(withPage("/projects/p1/pulls", null));
  expect(submenu("Plan views")).toBeInTheDocument();
  fireEvent.click(toggle("Plan views"));
  fireEvent.click(toggle("Run filters"));
  rerender(withPage("/projects/p1/runs/r1", null));
  expect(submenu("Run filters")).toBeInTheDocument();
  expect(submenu("Plan views")).not.toBeInTheDocument();
});

const openFlyout = (name: string, heading = name) => {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
  const menu = screen.getByRole("menu");
  return {
    label: within(menu).getByText(heading, { selector: "[data-slot=dropdown-menu-label]" }),
    items: within(menu)
      .getAllByRole("menuitemradio")
      .map((i) => [i.textContent, i.getAttribute("href"), i.getAttribute("aria-checked")]),
  };
};

test("collapsed to icons, Plan and Runs open their items in a flyout with a check on the current one", () => {
  const plan = renderSidebar({ pathname: "/projects/p1/plan", open: false });
  expect(submenu("Plan views")).not.toBeInTheDocument();
  // The icon is filled while a page of its section is open.
  expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("data-active", "true");
  expect(screen.getByRole("button", { name: "Runs, 3 active" })).toHaveAttribute("data-active", "false");
  expect(openFlyout("Plan").items).toEqual([
    ["Flow", "/projects/p1/plan?view=flow", "true"],
    ["Board", "/projects/p1/plan?view=board", "false"],
    ["Tree", "/projects/p1/plan?view=tree", "false"],
  ]);
  plan.unmount();

  renderSidebar({ pathname: "/projects/p1/runs/r1", open: false });
  expect(openFlyout("Runs, 3 active", "Runs").items).toEqual([
    ["All runs", "/projects/p1/runs", "true"],
    ["Active2", "/projects/p1/runs?status=active", "false"],
    ["Waiting1", "/projects/p1/runs?status=waiting", "false"],
    ["Failed", "/projects/p1/runs?status=failed", "false"],
    ["Done", "/projects/p1/runs?status=done", "false"],
  ]);
});

test("the Project settings button beside the switcher is lit on Project settings and in the graph editor", () => {
  for (const [pathname, lit] of [
    ["/projects/p1/settings", true],
    ["/projects/p1/graphs/plan-review", true],
    ["/projects/p1/plan", false],
  ] as const) {
    cleanup();
    renderSidebar({ pathname });
    const button = screen.getByRole("link", { name: "Project settings" });
    expect(button).toHaveAttribute("href", "/projects/p1/settings");
    expect(button.getAttribute("aria-current")).toBe(lit ? "page" : null);
    // No row of the nav is lit on Project settings.
    if (lit) expect(screen.getAllByRole("link", { current: "page" })).toEqual([button]);
  }
  cleanup();
  // Collapsed to icons the button hides; the switcher menu keeps the item.
  renderSidebar({ pathname: "/projects/p1/settings", open: false });
  expect(screen.queryByRole("link", { name: "Project settings" })).not.toBeInTheDocument();
});

test("outside a project the switcher shows the last project from the cookie", () => {
  const { unmount } = renderSidebar({ pathname: "/projects/p2/graphs" });
  expect(document.cookie).toContain("handoff_last_project=p2");
  unmount();

  renderSidebar({ pathname: "/inbox", lastProjectId: "p2" });
  expect(screen.getByRole("button", { name: "Project: example-shop. Switch project" })).toBeInTheDocument();
  expect(links(screen.getByRole("navigation", { name: "Home and Inbox" }))[0]).toEqual(["Home", "/projects/p2"]);
  expect(current()).toEqual(["Inbox"]);
});

test("without a project used last, the switcher shows the first project; without projects it offers to add one", () => {
  const { unmount } = renderSidebar({ pathname: "/settings" });
  expect(screen.getByRole("button", { name: "Project: handoff. Switch project" })).toBeInTheDocument();
  unmount();

  goTo("/settings");
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar projects={[]} inboxCount={0} worker={{ live: 0, queuedRuns: 0 }} />
      </SidebarProvider>
    </TooltipProvider>,
  );
  expect(screen.queryByRole("navigation", { name: "Plan" })).not.toBeInTheDocument();
  expect(links(screen.getByRole("navigation", { name: "Home and Inbox" }))).toEqual([["Inbox", "/inbox"]]);
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

test("the switcher menu starts with the project's settings, and picking another project keeps the page type", () => {
  const { unmount } = renderSidebar({ pathname: "/projects/p1/plan" });
  expect(openSwitcher(/^Project: handoff/)).toEqual([
    ["Project settings", "/projects/p1/settings"],
    ["example-shopexample-org/example-shop", "/projects/p2/plan"],
    ["demo-docsexample-org/demo-docs", "/projects/p3/plan"],
    ["Add project", "/settings?tab=projects&add=1"],
    ["Manage projects", "/settings?tab=projects"],
  ]);
  const menu = within(screen.getByRole("menu"));
  expect(menu.getByText("handoff", { selector: "[data-slot=dropdown-menu-label]" })).toBeInTheDocument();
  expect(menu.getByText("Switch project")).toBeInTheDocument();
  unmount();

  // From a run, the other project's runs; from outside a project, its Home.
  const run = renderSidebar({ pathname: "/projects/p1/runs/r1" });
  expect(openSwitcher(/^Project: handoff/)[1]).toEqual(["example-shopexample-org/example-shop", "/projects/p2/runs"]);
  run.unmount();
  // From the graph editor, the other project's settings, where its graphs are.
  const editor = renderSidebar({ pathname: "/projects/p1/graphs/plan-review" });
  expect(openSwitcher(/^Project: handoff/)[1]).toEqual(["example-shopexample-org/example-shop", "/projects/p2/settings"]);
  editor.unmount();
  renderSidebar({ pathname: "/library", lastProjectId: "p1" });
  expect(openSwitcher(/^Project: handoff/)[1]).toEqual(["example-shopexample-org/example-shop", "/projects/p2"]);
});

/** The sidebar beside a page that may tell it its section, as the issue page does. */
function withPage(pathname: string, page: ReactNode) {
  goTo(pathname);
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SidebarSectionProvider>
          <AppSidebar projects={PROJECTS} inboxCount={0} worker={{ live: 1, queuedRuns: 0 }} />
          {page}
        </SidebarSectionProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}

test("an issue page marks the section it tells the sidebar: Plan for an item of the plan, Issues for another issue", () => {
  const { rerender } = render(withPage("/projects/p1/issues/16", <SidebarSection section="plan" />));
  expect(current()).toEqual(["Plan"]);
  rerender(withPage("/projects/p1/issues/407", <SidebarSection section="issues" />));
  expect(current()).toEqual(["Issues"]);
});

test("until the issue page tells its section, a direct visit marks Issues and a click from another page keeps that page's item", () => {
  const direct = render(withPage("/projects/p1/issues/16", null));
  expect(current()).toEqual(["Issues"]);
  direct.unmount();

  const { rerender } = render(withPage("/projects/p1/plan", null));
  rerender(withPage("/projects/p1/issues/16", null));
  expect(current()).toEqual(["Plan"]);
  rerender(withPage("/projects/p1/issues/16", <SidebarSection section="plan" />));
  rerender(withPage("/projects/p1/issues/88", null));
  expect(current()).toEqual(["Plan"]);
  rerender(withPage("/projects/p1/issues/88", <SidebarSection section="issues" />));
  expect(current()).toEqual(["Issues"]);
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

/** The sidebar as the layout renders it, kept mounted across navigations, reading the Inbox count with `load`. */
function liveSidebar(load: () => Promise<number>, open = true) {
  const sidebar = (inboxCount: number) => (
    <TooltipProvider>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar projects={PROJECTS} inboxCount={inboxCount} worker={{ live: 1, queuedRuns: 0 }} loadInboxCount={load} inboxIntervalMs={20} />
      </SidebarProvider>
    </TooltipProvider>
  );
  const { rerender } = render(sidebar(1));
  return { rerender: (inboxCount: number) => rerender(sidebar(inboxCount)) };
}

test("the Inbox badge follows the count while the layout stays mounted", async () => {
  goTo("/projects/p1");
  let waiting = 1;
  liveSidebar(async () => waiting);
  expect(screen.getByRole("link", { name: "Inbox, 1 waiting" })).toBeInTheDocument();

  // Answered in another tab, by MCP or by the worker: the badge clears without a reload.
  waiting = 0;
  await waitFor(() => expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument());
  expect(screen.queryByText("1")).not.toBeInTheDocument();

  // Something new waits.
  waiting = 2;
  expect(await screen.findByRole("link", { name: "Inbox, 2 waiting" })).toBeInTheDocument();
});

test("the Inbox badge takes the count the layout renders again with, as after an answer", () => {
  goTo("/inbox");
  const { rerender } = liveSidebar(() => new Promise<number>(() => {}));
  expect(screen.getByRole("link", { name: "Inbox, 1 waiting" })).toBeInTheDocument();
  rerender(0);
  expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
});

test("collapsed, the Inbox dot follows the same count", async () => {
  goTo("/library");
  let waiting = 1;
  liveSidebar(async () => waiting, false);
  expect(screen.getByTestId("inbox-dot")).toBeInTheDocument();
  waiting = 0;
  await waitFor(() => expect(screen.queryByTestId("inbox-dot")).not.toBeInTheDocument());
  expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
});

