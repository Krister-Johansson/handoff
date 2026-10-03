import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHeader } from "./page-header";
import { TopBar, TopBarCrumbsProvider } from "./top-bar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => <button type="button">Notifications</button> }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => <button type="button">Listen</button> }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

function renderPage(page: React.ReactNode) {
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

test("the breadcrumb shows one crumb on Inbox", () => {
  const { container } = renderPage(<PageHeader crumbs={[{ label: "Inbox" }]} title="Inbox" description="Everything that waits on you." />);
  const bar = container.querySelector<HTMLElement>("[data-slot=top-bar]")!;
  const trail = within(bar).getByRole("navigation", { name: "breadcrumb" });
  expect(within(trail).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Inbox"]);
  expect(within(trail).getByText("Inbox")).toHaveAttribute("aria-current", "page");
  // The page keeps its title; the top bar holds the trail, the sidebar toggle and the voice and bell buttons. The assistant has no button here.
  expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toBeInTheDocument();
  expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Toggle sidebar", "Listen", "Notifications"]);
});
