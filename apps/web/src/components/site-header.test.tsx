import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SiteHeader } from "./site-header";

vi.mock("@/components/inbox-link", () => ({ InboxLink: () => <a href="/inbox">Inbox</a> }));
vi.mock("@/components/attention-notifier", () => ({ AttentionNotifier: () => null }));
vi.mock("@/components/worker-status", () => ({ WorkerStatus: () => null }));

test("the top bar leads to projects, the inbox and the library; runs are reached through their project", () => {
  render(<SiteHeader />);
  const nav = screen.getByRole("navigation");
  expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["Projects", "/projects"],
    ["Inbox", "/inbox"],
    ["Library", "/library"],
  ]);
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
});
