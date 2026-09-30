import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NotificationSettings } from "./notification-settings";

const ping = vi.hoisted(() => ({ playPing: vi.fn() }));
vi.mock("@/lib/ping", () => ping);

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static shown: string[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string) {
    FakeNotification.shown.push(title);
  }
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.shown = [];
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

test("turning desktop notifications on asks the browser first", async () => {
  render(<NotificationSettings />);
  fireEvent.click(screen.getByRole("switch", { name: "Desktop notifications" }));
  await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("switch", { name: "Desktop notifications" })).toBeChecked());
  expect(JSON.parse(localStorage.getItem("handoff.notify") ?? "{}")).toMatchObject({ desktop: true });
});

test("a test notification shows one and pings", async () => {
  FakeNotification.permission = "granted";
  localStorage.setItem("handoff.notify", JSON.stringify({ desktop: true, sound: true }));
  render(<NotificationSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Send a test notification" }));
  expect(FakeNotification.shown).toEqual(["handoff notifications work"]);
  expect(ping.playPing).toHaveBeenCalled();
});

test("a browser that blocks notifications is named on the page", () => {
  FakeNotification.permission = "denied";
  render(<NotificationSettings />);
  expect(screen.getByText(/blocks notifications for this site/i)).toBeInTheDocument();
});
