import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PlanRefresher } from "./plan-refresher";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  router.refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

test("the refresher calls router.refresh every 30 seconds while the document is visible and not while hidden", () => {
  render(<PlanRefresher readAt={Date.parse("2026-10-02T12:00:00Z")} />);
  expect(screen.getByText("Updated 0 s ago from GitHub")).toBeInTheDocument();

  act(() => void vi.advanceTimersByTime(12_000));
  expect(screen.getByText("Updated 12 s ago from GitHub")).toBeInTheDocument();
  act(() => void vi.advanceTimersByTime(18_000));
  expect(router.refresh).toHaveBeenCalledTimes(1);

  setVisibility("hidden");
  act(() => void vi.advanceTimersByTime(120_000));
  expect(router.refresh).toHaveBeenCalledTimes(1);

  setVisibility("visible");
  act(() => void vi.advanceTimersByTime(30_000));
  expect(router.refresh).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "Refresh from GitHub" }));
  expect(router.refresh).toHaveBeenCalledTimes(3);
});
