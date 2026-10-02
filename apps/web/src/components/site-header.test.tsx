import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SiteHeader } from "./site-header";

vi.mock("@/components/inbox-link", () => ({ InboxLink: () => <a href="/inbox">Inbox</a> }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/assistant/assistant-button", () => ({ AssistantButton: () => <button type="button">Assistant</button> }));
vi.mock("@/components/worker-status", () => ({ WorkerStatus: () => null }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => null }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1/runs/r1" }));

test("the top bar leads to projects, the inbox and the library; runs are reached through their project", () => {
  render(<SiteHeader />);
  const nav = screen.getByRole("navigation");
  expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["Projects", "/projects"],
    ["Inbox", "/inbox"],
    ["Library", "/library"],
  ]);
  expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
});
