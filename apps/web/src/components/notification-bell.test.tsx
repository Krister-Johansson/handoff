import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NotificationJson } from "@/lib/notifications";
import { NotificationBell } from "./notification-bell";

const ping = vi.hoisted(() => ({ playPing: vi.fn() }));
vi.mock("@/lib/ping", () => ping);
vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const item = (id: string, kind: NotificationJson["kind"], title: string, createdAt: string, unread = true): NotificationJson => ({
  id,
  kind,
  title,
  body: "Add a CHANGELOG.md",
  href: `/projects/p1/runs/${id}`,
  createdAt,
  unread,
});
const started = item("e1", "started", "sandbox: run started", "2026-10-01T10:00:00.000Z");
const failed = item("e2", "failed", "sandbox: run failed at coder", "2026-10-01T10:05:00.000Z");
const asked = item("q1", "input", "sandbox: gate asks a question", "2026-10-01T10:06:00.000Z");
const done = item("e3", "finished", "sandbox: run finished", "2026-10-01T10:07:00.000Z");

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static shown: string[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string) {
    FakeNotification.shown.push(title);
  }
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.shown = [];
  ping.playPing.mockClear();
  for (const fn of [toast, toast.success, toast.error, toast.warning, toast.info]) fn.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  document.title = "handoff";
});
afterEach(() => vi.unstubAllGlobals());

test("the bell lists the latest notifications, newest first, and counts the unread ones", async () => {
  render(<NotificationBell load={async () => ({ items: [failed, started], unread: 1 })} markRead={vi.fn()} intervalMs={10_000} />);
  const bell = await screen.findByRole("button", { name: "1 unread notification" });
  await waitFor(() => expect(document.title).toBe("(1) handoff"));
  fireEvent.click(bell);
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getAllByRole("link").map((l) => l.textContent)).toEqual([
    expect.stringContaining("sandbox: run failed at coder"),
    expect.stringContaining("sandbox: run started"),
    "All notifications",
  ]);
  expect(within(panel).getByRole("link", { name: "All notifications" })).toHaveAttribute("href", "/notifications");
  expect(within(panel).queryByText("Notification settings")).not.toBeInTheDocument();
});

test("opening the bell marks what it shows as read", async () => {
  const markRead = vi.fn(async () => {});
  render(<NotificationBell load={async () => ({ items: [failed, started], unread: 2 })} markRead={markRead} intervalMs={10_000} />);
  fireEvent.click(await screen.findByRole("button", { name: "2 unread notifications" }));
  expect(markRead).toHaveBeenCalledWith(failed.createdAt);
  expect(await screen.findByRole("button", { name: "No unread notifications" })).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe("handoff"));
});

test("notifications there when the page opens make no toast; new ones each make one, by kind", async () => {
  localStorage.setItem("handoff.notify", JSON.stringify({ desktop: true, sound: true }));
  const load = vi
    .fn()
    .mockResolvedValueOnce({ items: [started], unread: 1 })
    .mockResolvedValue({ items: [done, asked, failed, started], unread: 4 });
  render(<NotificationBell load={load} markRead={vi.fn()} intervalMs={20} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  expect(toast).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith(done.title, expect.objectContaining({ description: done.body }));
  expect(toast.warning).toHaveBeenCalledWith(asked.title, expect.objectContaining({ description: asked.body }));
  expect(toast.error).toHaveBeenCalledWith(failed.title, expect.objectContaining({ description: failed.body }));
  // A person is told on the desktop, with one ping, about what needs them or ended; not about a start.
  expect(FakeNotification.shown).toEqual([done.title, asked.title, failed.title]);
  expect(ping.playPing).toHaveBeenCalledTimes(1);
  await act(() => new Promise((r) => setTimeout(r, 60)));
  expect(toast.success).toHaveBeenCalledTimes(1);
});

test("many new notifications at once make one toast", async () => {
  const many = Array.from({ length: 5 }, (_, i) => item(`n${i}`, "started", `sandbox: run started ${i}`, `2026-10-01T10:1${i}:00.000Z`));
  const load = vi.fn().mockResolvedValueOnce({ items: [], unread: 0 }).mockResolvedValue({ items: many, unread: 5 });
  render(<NotificationBell load={load} markRead={vi.fn()} intervalMs={20} />);
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith("5 new notifications", expect.anything()));
  expect(toast).not.toHaveBeenCalled();
});
