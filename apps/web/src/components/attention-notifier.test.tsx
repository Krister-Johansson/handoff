import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AttentionNotifier } from "./attention-notifier";

const ping = vi.hoisted(() => ({ playPing: vi.fn() }));
vi.mock("@/lib/ping", () => ping);
vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));

const a = { id: "question:1", kind: "question" as const, title: "sandbox: gate asks a question", body: "Which license?", href: "/runs/r1" };
const b = { id: "failed:2", kind: "failed" as const, title: "sandbox: run failed at coder", body: "Add a CHANGELOG.md", href: "/runs/r2" };

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static shown: { title: string; options?: NotificationOptions }[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.shown.push({ title, ...(options ? { options } : {}) });
  }
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.shown = [];
  FakeNotification.permission = "granted";
  FakeNotification.requestPermission.mockClear();
  ping.playPing.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  document.title = "handoff";
});
afterEach(() => vi.unstubAllGlobals());

test("what needs attention when the page opens is not notified; something new is, with a ping", async () => {
  localStorage.setItem("handoff.notify", JSON.stringify({ desktop: true, sound: true }));
  const load = vi.fn().mockResolvedValueOnce([a]).mockResolvedValue([a, b]);
  render(<AttentionNotifier load={load} intervalMs={20} />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(FakeNotification.shown).toEqual([{ title: b.title, options: { body: b.body, tag: b.id } }]));
  expect(ping.playPing).toHaveBeenCalledTimes(1);
  await act(() => new Promise((r) => setTimeout(r, 60)));
  expect(FakeNotification.shown).toHaveLength(1);
});

test("the bell lists what needs attention and the tab title shows how many", async () => {
  render(<AttentionNotifier load={async () => [a, b]} intervalMs={10_000} />);
  const bell = await screen.findByRole("button", { name: "2 things need your attention" });
  await waitFor(() => expect(document.title).toBe("(2) handoff"));
  fireEvent.click(bell);
  expect(await screen.findByRole("link", { name: /gate asks a question/ })).toHaveAttribute("href", "/runs/r1");
  expect(screen.getByRole("link", { name: /run failed at coder/ })).toHaveAttribute("href", "/runs/r2");
});

test("turning desktop notifications on asks the browser first", async () => {
  FakeNotification.permission = "default";
  render(<AttentionNotifier load={async () => []} intervalMs={10_000} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nothing needs your attention" }));
  fireEvent.click(await screen.findByRole("switch", { name: "Desktop notifications" }));
  await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("switch", { name: "Desktop notifications" })).toBeChecked());
  expect(JSON.parse(localStorage.getItem("handoff.notify") ?? "{}")).toMatchObject({ desktop: true });
});
