import { expect, test, vi } from "vitest";
import { homePath } from "@/lib/last-project";
import ProjectPage from "./[projectId]/page";
import ProjectsPage from "./page";

const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect ${href}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));
// The Home page's reads; an old link never gets that far.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined, getProjects: () => undefined }));
vi.mock("@/server/overview", () => ({ loadOverview: vi.fn() }));
vi.mock("@/server/project-page", () => ({ projectPage: vi.fn(), repoUrl: vi.fn(), sectionCrumbs: vi.fn() }));

const open = (query: Record<string, string>) => ProjectPage({ params: Promise.resolve({ projectId: "p1" }), searchParams: Promise.resolve(query) });

test("an old ?tab= link redirects to its route", async () => {
  await expect(open({ tab: "issues", issues: "started" })).rejects.toThrow("redirect /projects/p1/issues?issues=started");
  await expect(open({ tab: "pulls", pr: "merged" })).rejects.toThrow("redirect /projects/p1/pulls?pr=merged");
  await expect(open({ tab: "graphs" })).rejects.toThrow("redirect /projects/p1/graphs");
  await expect(open({ tab: "settings" })).rejects.toThrow("redirect /projects/p1/settings");
  await expect(open({ tab: "runs" })).rejects.toThrow("redirect /projects/p1/runs");
  await expect(open({ tab: "nowhere" })).rejects.toThrow("redirect /projects/p1/runs");
});

test("/projects redirects to Settings, Projects", () => {
  expect(() => ProjectsPage()).toThrow("redirect /settings?tab=projects");
});

test("/ opens the Home page of the project used last, else of the first project, else Settings, Projects to add one", () => {
  const projects = [{ id: "p1" }, { id: "p2" }];
  expect(homePath(projects, "p2")).toBe("/projects/p2");
  expect(homePath(projects, undefined)).toBe("/projects/p1");
  // A project deleted since keeps no claim on the cookie.
  expect(homePath(projects, "gone")).toBe("/projects/p1");
  expect(homePath([], "p2")).toBe("/settings?tab=projects");
});
