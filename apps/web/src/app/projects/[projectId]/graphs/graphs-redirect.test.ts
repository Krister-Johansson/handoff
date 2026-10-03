import { expect, test, vi } from "vitest";
import ProjectGraphsPage from "./page";

const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect ${href}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

test("the old Graphs page redirects to Graphs in project settings", async () => {
  await expect(ProjectGraphsPage({ params: Promise.resolve({ projectId: "p1" }) })).rejects.toThrow("redirect /projects/p1/settings?tab=graphs");
});
