import { afterEach, expect, test, vi } from "vitest";
import { fakeGraphql } from "../testing/fake-fetch.ts";
import { OctokitProjects } from "./octokit-projects.ts";

// Octokit's throttle runs on timers, so this file fakes them; its queue is shared by every Octokit in the process.
afterEach(() => {
  vi.useRealTimers();
});

const repo = { owner: "octo", name: "sample" };
const dateField = (id: string) => ({ __typename: "ProjectV2Field", id, dataType: "DATE" });

test("a plan read made while a 60-item schedule writes answers within seconds, behind Octokit's one-second spacing of GraphQL calls", async () => {
  vi.useFakeTimers();
  const issues = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { fetch, operations } = fakeGraphql({
    PlanProject: () => ({ user: { projectV2: { id: "PVT_3", number: 3, url: "u", title: "t", field: null, start: dateField("F_start"), target: dateField("F_target") } } }),
    PlanItemIds: () => ({
      repository: Object.fromEntries(issues.map((n) => [`i${n}`, { projectItems: { nodes: [{ id: `PVTI_${n}`, project: { id: "PVT_3" } }] } }])),
    }),
    SetManyPlanFields: () => ({}),
    PlanItems: () => ({ user: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }),
  });
  // The dashboard's port, with the throttle on.
  const projects = OctokitProjects.withToken("t", { fetch });
  const started = Date.now();

  const writing = projects.setManyPlanFields(
    repo,
    3,
    issues.map((issue) => ({ issue, fields: { start: "2026-10-06", target: "2026-10-09" } })),
  );
  await vi.advanceTimersByTimeAsync(1_500);
  let answeredAfter: number | undefined;
  const reading = projects.listItems("octo", 3, repo).then(() => (answeredAfter = Date.now() - started));
  await vi.advanceTimersByTimeAsync(60_000);

  expect(await writing).toEqual(issues.map((issue) => ({ issue, result: "set" })));
  await reading;
  // Eight write-side requests and the read, one second apart: the read waits seconds, not minutes.
  expect(operations.length).toBe(9);
  expect(answeredAfter).toBeLessThanOrEqual(10_000);
});
