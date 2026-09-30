import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, graphVersions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createGraphFromTemplate, createProject, deleteGraph, getGraphForEdit, getGraphVersion, listGraphVersions, renameGraph, getProjectDetail, listProjects, runAgain, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

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

  test("createProject without a name takes it from the repository, made unique", async () => {
    await createProject(db, { name: "gqlprune", repo: "someone/other", defaultBranch: "main" });
    const project = await createProject(db, { repo: "octo/gqlPrune", defaultBranch: "main" });
    expect(project.name).toBe("gqlprune-2");
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

describe("graph versions", () => {
  test("listGraphVersions returns versions newest first and getGraphVersion loads one", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const edited = structuredClone(linear);
    edited.nodes[1]!.attributes.label = "Implement";
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: edited });
    const versions = await listGraphVersions(db, project.id, "g");
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const v1 = await getGraphVersion(db, project.id, "g", 1);
    expect((v1?.document as typeof linear).nodes[1]!.attributes.label).toBe("Code");
  });
});

describe("renaming and deleting graphs", () => {
  test("renameGraph renames within the project and keeps its versions", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    await renameGraph(db, project.id, "g", "main-flow");
    expect((await getGraphForEdit(db, project.id, "main-flow"))?.version).toBe(1);
    expect(await getGraphForEdit(db, project.id, "g")).toBeUndefined();
  });

  test("renameGraph refuses an invalid or taken name", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "a", document: linear });
    await saveGraphVersion(db, { projectId: project.id, name: "b", document: linear });
    await expect(renameGraph(db, project.id, "a", "b")).rejects.toThrow(/already/);
    await expect(renameGraph(db, project.id, "a", "Bad Name")).rejects.toThrow(/lowercase/);
  });

  test("deleteGraph removes a graph no run has used", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    await deleteGraph(db, project.id, "g");
    expect(await getGraphForEdit(db, project.id, "g")).toBeUndefined();
  });

  test("deleteGraph refuses while runs use one of its versions", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    await expect(deleteGraph(db, project.id, "g")).rejects.toThrow(/1 run/);
  });

  test("runAgain starts a new run with the same project and task on the graph's latest version", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const first = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a slugify helper" });
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.id));
    const edited = structuredClone(linear);
    edited.nodes[1]!.attributes.label = "Implement";
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: edited });

    const again = await runAgain(db, first.id);
    expect(again.id).not.toBe(first.id);
    const [row] = await db.select().from(runs).where(eq(runs.id, again.id));
    expect(row).toMatchObject({ projectId: project.id, task: "Add a slugify helper", status: "queued" });
    const [version] = await db.select().from(graphVersions).where(eq(graphVersions.id, row!.graphVersionId));
    expect(version?.version).toBe(2);
  });

  test("runAgain refuses a run that is still active", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    await expect(runAgain(db, run.id)).rejects.toThrow(/still queued/);
  });

  test("a demo project cannot start runs, because its repository does not exist", async () => {
    const project = await createProject(db, { name: "demo", repo: "demo/sample", defaultBranch: "main" });
    await db.update(projects).set({ isDemo: true }).where(eq(projects.id, project.id));
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    await expect(startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" })).rejects.toThrow(/demo project/);
    expect(await db.select().from(runs)).toEqual([]);
  });

  test("a run started with issues links them, and an empty task defaults to their titles", async () => {
    const github = new FakeGitHub();
    github.issues.set(12, { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "2nd becomes nd", state: "open" });
    github.issues.set(14, { number: 14, title: "Document slugify", url: "https://github.com/octo/sample/issues/14", body: "", state: "open" });
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [12, 14] }, github);
    expect(run.task).toBe("#12 Slugify drops digits\n#14 Document slugify");
    expect(run.issues.map((i) => i.number)).toEqual([12, 14]);
    expect((run.state as { issues: { body: string }[] }).issues[0]!.body).toBe("2nd becomes nd");

    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
    const again = await runAgain(db, run.id);
    expect(again.issues.map((i) => i.number)).toEqual([12, 14]);
  });

  test("a run needs a task or at least one issue", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    await expect(startRunFromGraph(db, { projectId: project.id, graphName: "g", task: " " })).rejects.toThrow(/task/);
  });
});
