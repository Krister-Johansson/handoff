import { expect, test } from "vitest";
import { searchPages } from "./pages";
import { parseQuery, searchResults, type SearchHit } from "./results";
import type { SearchRecords, SearchTasks } from "./types";

const records: SearchRecords = {
  projectId: "p1",
  projects: [
    { id: "p1", name: "handoff", repo: "octo/handoff", planMode: "timeline", current: true },
    { id: "p2", name: "example-shop", repo: "acme/example-shop", planMode: "timeline", current: false },
  ],
  runs: [
    { id: "5d2e8c60-0000", shortId: "5d2e8c60", projectId: "p1", title: "Plan read model and the Ready gate", issues: [53], status: "succeeded", branch: "feat/53-plan-read-model", prNumber: null, at: "2026-10-01T00:00:00Z" },
    { id: "0e7d44b1-0000", shortId: "0e7d44b1", projectId: "p1", title: "Plan mode switch in project settings", issues: [47], status: "failed", branch: "feat/47-plan-mode", prNumber: null, at: "2026-09-29T00:00:00Z" },
    { id: "9a9a9a9a-0000", shortId: "9a9a9a9a", projectId: "p1", title: "Status writes", issues: [54], status: "succeeded", branch: "feat/54-explain-plan", prNumber: null, at: "2026-09-28T00:00:00Z" },
    { id: "e4b0a917-0000", shortId: "e4b0a917", projectId: "p2", title: "Checkout keeps the cart after sign in", issues: [31], status: "running", branch: "feat/31-cart", prNumber: null, at: "2026-10-03T00:00:00Z" },
  ],
  chats: [
    { id: "c1", title: "Plan the voice epic", projectId: "p1", pinned: true, at: "2026-10-01T00:00:00Z" },
    { id: "c2", title: "Why checkout drops the cart", projectId: "p2", pinned: false, at: "2026-09-30T00:00:00Z" },
  ],
};

const task = (number: number, title: string) => ({ projectId: "p1", number, title, kind: "task" as const, status: "Ready" as const, state: "open" as const });
const tasks: SearchTasks = {
  sources: [{ projectId: "p1", repo: "octo/handoff", source: "plan" }],
  tasks: [
    task(4, "Explain the plan"),
    task(41, "Shaping tools for the assistant"),
    task(44, "Plan mode per project"),
    task(47, "Plan mode switch in project settings"),
    task(53, "Plan read model and the Ready gate"),
    task(60, "Planner asks its questions before it plans"),
    task(61, "Make plans faster"),
    task(62, "Unrelated work"),
  ],
};

const data = { records, tasks, pages: searchPages(records.projects) };
const titleOf = (hit: SearchHit) => (hit.kind === "task" ? hit.task.title : hit.kind === "run" ? hit.run.title : hit.kind === "chat" ? hit.chat.title : hit.page.label);
const view = (raw: string, opts: Parameters<typeof searchResults>[2] = {}) => searchResults(data, raw, opts);

test("# filters to tasks and / to pages; the term follows the prefix", () => {
  expect(parseQuery("#4")).toEqual({ prefix: "#", term: "4" });
  expect(parseQuery("/sett")).toEqual({ prefix: "/", term: "sett" });
  expect(parseQuery("  plan ")).toEqual({ prefix: null, term: "plan" });
  expect(parseQuery("#")).toEqual({ prefix: "#", term: "" });
  expect(view("#4").filter).toBe("tasks");
  expect(view("/sett").filter).toBe("pages");
  expect(view("plan", { filter: "runs" }).filter).toBe("runs");
});

test("in All, results come in groups of 3 with how many more each holds, and the matched part of the title", () => {
  const { groups, counts } = view("plan");
  expect(groups.map((g) => [g.id, g.total, g.hits.length, g.hidden])).toEqual([
    ["tasks", 6, 3, 3],
    ["runs", 3, 3, 0],
    ["pages", 2, 2, 0],
    ["chats", 1, 1, 0],
  ]);
  expect(counts).toEqual({ all: 12, tasks: 6, runs: 3, pages: 2, chats: 1 });
  // A title that starts with the term comes before one that only holds it.
  expect(groups[0]!.hits.map(titleOf)).toEqual(["Plan mode per project", "Plan mode switch in project settings", "Plan read model and the Ready gate"]);
  expect(groups[0]!.hits[0]!.match).toEqual({ title: [0, 4], number: 0 });
  // A run's branch matches too, with nothing to bold in its title.
  expect(groups[1]!.hits.map((h) => [titleOf(h), h.match.title])).toContainEqual(["Status writes", null]);
});

test("Show more lists the whole group", () => {
  const { groups } = view("plan", { expanded: new Set(["tasks"]) });
  expect(groups[0]!.hits).toHaveLength(6);
  expect(groups[0]!.hidden).toBe(0);
});

test("a filter lists all of its kind and nothing else", () => {
  const { groups } = view("plan", { filter: "tasks" });
  expect(groups.map((g) => [g.id, g.hits.length, g.hidden])).toEqual([["tasks", 6, 0]]);
});

test("#4 finds the tasks whose number starts with 4, by number, with the digits marked", () => {
  const { groups, counts } = view("#4");
  expect(groups).toHaveLength(1);
  expect(groups[0]!.hits.map((h) => (h.kind === "task" ? h.task.number : 0))).toEqual([4, 41, 44, 47]);
  expect(groups[0]!.hits[1]!.match).toEqual({ title: null, number: 1 });
  expect(counts.tasks).toBe(4);
});

test("# alone lists every task, and #words match task titles", () => {
  expect(view("#").groups[0]!.hits).toHaveLength(8);
  expect(view("#shaping").groups[0]!.hits.map(titleOf)).toEqual(["Shaping tools for the assistant"]);
});

test("/sett lists Settings, Project settings and their sections", () => {
  const titles = view("/sett").groups.flatMap((g) => g.hits.map(titleOf));
  expect(titles.slice(0, 2)).toEqual(["Settings", "Project settings"]);
  expect(titles).toContain("Plan mode");
  expect(titles).toContain("Appearance");
});

test("another project's runs, chats and name show under Other projects, and in All projects they join their groups", () => {
  const current = view("checkout");
  expect(current.groups.map((g) => g.id)).toEqual(["other"]);
  expect(current.groups[0]!.hits.map(titleOf)).toEqual(["Checkout keeps the cart after sign in", "Why checkout drops the cart"]);
  expect(current.counts).toEqual({ all: 2, tasks: 0, runs: 1, pages: 0, chats: 1 });
  expect(view("example").groups.map((g) => [g.id, g.hits.map(titleOf)])).toEqual([["other", ["example-shop"]]]);

  const all = searchResults({ ...data, all: true }, "checkout", {});
  expect(all.groups.map((g) => g.id)).toEqual(["runs", "chats"]);
});

test("search kept to its project leaves out other projects' runs, chats and names, and counts what it left out", () => {
  const only = { ...data, onlyProject: true };
  const checkout = searchResults(only, "checkout", {});
  expect(checkout.groups).toEqual([]);
  expect(checkout.counts).toEqual({ all: 0, tasks: 0, runs: 0, pages: 0, chats: 0 });
  expect(checkout.elsewhere).toBe(2);
  expect(searchResults(only, "example", {})).toMatchObject({ groups: [], elsewhere: 1 });
  // A filter counts only what it shows elsewhere.
  expect(searchResults(only, "checkout", { filter: "chats" }).elsewhere).toBe(1);
  // The project's own results and the pages of all projects stay.
  const plan = searchResults(only, "plan", {});
  expect(plan.groups.map((g) => [g.id, g.total])).toEqual([
    ["tasks", 6],
    ["runs", 3],
    ["pages", 2],
    ["chats", 1],
  ]);
  expect(plan.elsewhere).toBe(0);
  expect(searchResults(only, "/sett", {}).groups.flatMap((g) => g.hits.map(titleOf))).toContain("Settings");
  // All projects still finds them, in their groups.
  const all = searchResults({ ...only, all: true }, "checkout", {});
  expect(all.groups.map((g) => g.id)).toEqual(["runs", "chats"]);
  expect(all.elsewhere).toBe(0);
});

test("an empty query finds nothing in All, and lists the whole kind under a filter", () => {
  expect(view("").groups).toEqual([]);
  expect(view("", { filter: "runs" }).groups[0]!.hits).toHaveLength(3);
});

test("before the tasks arrive, the Tasks group is left out and counted as none", () => {
  const { groups, counts } = searchResults({ ...data, tasks: undefined }, "plan", {});
  expect(groups.map((g) => g.id)).toEqual(["runs", "pages", "chats"]);
  expect(counts.tasks).toBe(0);
});

test("every word of the query must match", () => {
  expect(view("plan gate").groups.flatMap((g) => g.hits.map(titleOf))).toEqual(["Plan read model and the Ready gate", "Plan read model and the Ready gate"]);
});
