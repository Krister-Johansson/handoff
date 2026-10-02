import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHeader } from "./page-header";
import { TopBar, TopBarCrumbsProvider } from "./top-bar";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/assistant/assistant-button", () => ({ AssistantButton: () => null }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => null }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

/** The page under the top bar, as the layout puts it. */
function renderInShell(page: ReactNode) {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <TopBarCrumbsProvider>
          <TopBar />
          <main>{page}</main>
        </TopBarCrumbsProvider>
      </SidebarProvider>
    </TooltipProvider>,
  );
}

test("the header shows the page title, its description and actions, and puts its trail of links in the top bar", () => {
  const { container } = renderInShell(
    <PageHeader
      crumbs={[{ label: "todooverkill", href: "/projects/p1" }, { label: "Runs", href: "/projects/p1/runs" }, { label: "#3 F03 Prisma" }]}
      title="#3 F03 Prisma"
      description="Every step of this run."
      actions={<button type="button">Cancel run</button>}
    />,
  );
  const trail = within(container.querySelector<HTMLElement>("[data-slot=top-bar]")!).getByRole("navigation", { name: "breadcrumb" });
  expect(within(trail).getByRole("link", { name: "todooverkill" })).toHaveAttribute("href", "/projects/p1");
  expect(within(trail).getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/projects/p1/runs");
  expect(within(trail).getByText("#3 F03 Prisma")).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { level: 1, name: "#3 F03 Prisma" })).toBeInTheDocument();
  expect(screen.getByText("Every step of this run.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
});

test("a crumb with siblings opens a searchable list to switch to one of them", () => {
  renderInShell(
    <PageHeader
      crumbs={[
        { label: "todooverkill", href: "/projects/p1" },
        {
          label: "master",
          href: "/projects/p1/graphs/master",
          menuLabel: "graphs",
          menu: [
            { label: "master", href: "/projects/p1/graphs/master", current: true },
            { label: "quick", href: "/projects/p1/graphs/quick" },
            { label: "review", href: "/projects/p1/graphs/review" },
          ],
        },
      ]}
      title="master"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Switch from master" }));
  const search = screen.getByPlaceholderText("Search graphs");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["master", "quick", "review"]);
  fireEvent.change(search, { target: { value: "qui" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["quick"]);
  fireEvent.click(screen.getByRole("option", { name: "quick" }));
  expect(push).toHaveBeenCalledWith("/projects/p1/graphs/quick");
});

test("a run in the list shows its status", () => {
  renderInShell(
    <PageHeader
      crumbs={[{ label: "#3 F03 Prisma", href: "/projects/p1/runs/r3", menuLabel: "runs", menu: [{ label: "#3 F03 Prisma", href: "/projects/p1/runs/r3", current: true, status: "succeeded" }] }]}
      title="#3 F03 Prisma"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Switch from #3 F03 Prisma" }));
  expect(within(screen.getByRole("option")).getByText("succeeded")).toBeInTheDocument();
});
