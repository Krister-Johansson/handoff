import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, graphVersions, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createGraphFromTemplate, createProject, getGraphForEdit, getProjectDetail, listProjects, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

describe("projects and graphs", () => {
  test("createProject validates owner/name and lists the project", async () => {
    await expect(createProject(db, { name: "x", repo: "nope", defaultBranch: "main" })).rejects.toThrow(/owner\/name/);
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    expect((await listProjects(db)).map((p) => p.name)).toEqual(["sandbox"]);
    expect(project).toMatchObject({ repoOwner: "octo", repoName: "sample" });
  });

  test("createProject stores the GitHub repository id when a GitHub client is available", async () => {
    const github = new FakeGitHub();
    github.repoId = 777;
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" }, github);
    expect(project.repoId).toBe(777);
  });

  test("createProject refuses a repository GitHub cannot find", async () => {
    const github = new FakeGitHub();
    github.getRepoId = async () => {
      throw new Error("Not Found");
    };
    await expect(createProject(db, { name: "sandbox", repo: "octo/missing", defaultBranch: "main" }, github)).rejects.toThrow(/octo\/missing/);
    expect(await listProjects(db)).toEqual([]);
  });

  test("a template creates version 1 of a graph", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await createGraphFromTemplate(db, project.id, "main", "loop");
    const graph = await getGraphForEdit(db, project.id, "main");
    expect(graph?.version).toBe(1);
    expect((graph?.document as { nodes: unknown[] }).nodes).toHaveLength(7);
  });

  test("save rejects a graph that does not compile with the compile errors", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    const broken = structuredClone(linear);
    broken.attributes.startNode = "ghost";
    const result = await saveGraphVersion(db, { projectId: project.id, name: "g", document: broken });
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "missing_start_node" })] });
    expect(await db.select().from(graphVersions)).toEqual([]);
  });

  test("saving creates a new graph version and leaves in-flight runs pinned", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    const edited = structuredClone(linear);
    edited.nodes[1]!.attributes.label = "Implement";
    const result = await saveGraphVersion(db, { projectId: project.id, name: "g", document: edited });
    expect(result).toMatchObject({ ok: true, version: 2 });
    const [pinned] = await db.select().from(runs).where(eq(runs.id, run.id));
    const [v1] = await db.select().from(graphVersions).where(eq(graphVersions.id, pinned!.graphVersionId));
    expect(v1?.version).toBe(1);
    expect((await listProjects(db))[0]).toMatchObject({ runCount: 1, activeRuns: 1 });
    const detail = await getProjectDetail(db, project.id);
    expect(detail?.graphs).toEqual([expect.objectContaining({ name: "g", latestVersion: 2 })]);
    expect(detail?.runs.map((r) => r.id)).toEqual([run.id]);
  });
});
