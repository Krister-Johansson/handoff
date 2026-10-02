import { expect, test, vi } from "vitest";
import { FakeProjects } from "@handoff/github/testing";
import { startSchedulerWith } from "./scheduler-access.ts";

test("the worker starts the scheduler only with Projects access and logs why not", () => {
  const lines: string[] = [];
  const log = (message: string) => lines.push(message);
  const handle = { stop: async () => {} };
  const start = vi.fn(() => handle);

  const projects = new FakeProjects();
  expect(startSchedulerWith(projects, start, log)).toBe(handle);
  expect(start).toHaveBeenCalledWith(projects);
  expect(lines).toEqual([]);

  start.mockClear();
  expect(startSchedulerWith(undefined, start, log)).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  expect(lines).toEqual([expect.stringMatching(/^The scheduler is off: .*GitHub Projects.*gh auth refresh -s project/)]);
});
