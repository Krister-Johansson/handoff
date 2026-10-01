import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { followTargets, useFollow } from "./use-follow";

test("the nodes to follow are the ones running or waiting", () => {
  expect(
    followTargets({
      planner: { status: "passed", attempts: 1 },
      coder: { status: "running", attempts: 2 },
      gate: { status: "waiting", attempts: 1 },
      merge: { status: "pending", attempts: 1 },
    }),
  ).toEqual(["coder", "gate"]);
});

test("following zooms to the active nodes, again whenever they change, until the person moves the view", () => {
  const fit = vi.fn();
  const { result, rerender } = renderHook(({ targets }) => useFollow(targets, fit), { initialProps: { targets: ["planner"] } });
  expect(result.current.following).toBe(false);
  expect(fit).not.toHaveBeenCalled();

  act(() => result.current.toggle());
  expect(result.current.following).toBe(true);
  expect(fit).toHaveBeenLastCalledWith(["planner"]);

  rerender({ targets: ["coder"] });
  expect(fit).toHaveBeenLastCalledWith(["coder"]);

  // The follow's own zoom moves the view without an event; that keeps following.
  act(() => result.current.onMoveStart(null));
  expect(result.current.following).toBe(true);

  act(() => result.current.onMoveStart(new MouseEvent("wheel")));
  expect(result.current.following).toBe(false);
  fit.mockClear();
  rerender({ targets: ["tester"] });
  expect(fit).not.toHaveBeenCalled();

  act(() => result.current.toggle());
  expect(fit).toHaveBeenLastCalledWith(["tester"]);
});

test("with nothing active, following waits without moving the view", () => {
  const fit = vi.fn();
  const { result } = renderHook(() => useFollow([], fit));
  act(() => result.current.toggle());
  expect(result.current.following).toBe(true);
  expect(fit).not.toHaveBeenCalled();
});
