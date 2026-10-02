import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "./app-shell";
import { AppSidebar } from "./app-sidebar";
import { PageHeader } from "./page-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1/runs", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => <button type="button">Notifications</button> }));
vi.mock("@/components/assistant/assistant-button", () => ({ AssistantButton: () => <button type="button">Assistant</button> }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => <button type="button">Listen</button> }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

/** What Tab reaches, in order: links and buttons that are neither disabled nor taken out with tabindex=-1. */
const tabStops = () => [...document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, [tabindex]")].filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"));

test("Skip to content is the first tab stop", () => {
  render(
    <TooltipProvider>
      <AppShell sidebarOpen sidebar={<AppSidebar projects={[{ id: "p1", name: "handoff", repo: "Krister-Johansson/handoff", activeRuns: 0 }]} inboxCount={0} worker={{ live: 1, queuedRuns: 0 }} />}>
        <main>
          <PageHeader crumbs={[{ label: "handoff", href: "/projects/p1" }, { label: "Runs" }]} title="Runs" />
        </main>
      </AppShell>
    </TooltipProvider>,
  );
  const skip = tabStops()[0]!;
  expect(skip).toHaveAccessibleName("Skip to content");
  expect(skip).toHaveAttribute("href", "#content");
  // It leads past the sidebar and the top bar to the page.
  const content = document.getElementById("content")!;
  expect(content).toContainElement(screen.getByRole("heading", { level: 1, name: "Runs" }));
  for (const toggle of screen.getAllByRole("button", { name: "Toggle sidebar" })) expect(content).not.toContainElement(toggle);
});
