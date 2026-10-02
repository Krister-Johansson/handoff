import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { asc, eq, events, graphVersions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createGraphFromTemplate, createProject, deleteGraph, getGraphForEdit, getGraphVersion, listGraphVersions, renameGraph, getProjectDetail, listProjectGraphs, listProjects, runAgain, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

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

  test("the plan, review, approve, build template is saved as a graph that compiles", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    const saved = await createGraphFromTemplate(db, project.id, "plan-first", "plan");
    expect(saved).toMatchObject({ ok: true });
    const graph = await getGraphForEdit(db, project.id, "plan-first");
    expect((graph?.document as { nodes: { key: string }[] }).nodes.map((n) => n.key)).toEqual(["start", "planner", "plan-review", "approval", "coder", "tester", "ask", "pr", "merge", "finish"]);
  });

  test("an empty graph starts with a Start node", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await createGraphFromTemplate(db, project.id, "blank", "empty");
    const graph = await getGraphForEdit(db, project.id, "blank");
    expect(graph?.document).toMatchObject({ attributes: { startNode: "start" }, nodes: [{ key: "start", attributes: { type: "start" } }], edges: [] });
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

  test("the project's default graph is the one its latest run used, else the last one changed", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "used", document: linear });
    expect((await getProjectDetail(db, project.id))!.defaultGraph).toBe("used");
    await startRunFromGraph(db, { projectId: project.id, graphName: "used", task: "Add a CHANGELOG.md" });
    await saveGraphVersion(db, { projectId: project.id, name: "newer", document: linear });
    expect((await getProjectDetail(db, project.id))!.defaultGraph).toBe("used");
  });

  test("a project's graphs list their latest version, when they were saved and how many runs used them", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "master", document: linear });
    await saveGraphVersion(db, { projectId: project.id, name: "master", document: linear });
    await saveGraphVersion(db, { projectId: project.id, name: "quick", document: linear });
    await startRunFromGraph(db, { projectId: project.id, graphName: "master", task: "One" });
    await startRunFromGraph(db, { projectId: project.id, graphName: "master", task: "Two" });
    const list = await listProjectGraphs(db, project.id);
    expect(list.map((g) => [g.name, g.latestVersion, g.runs])).toEqual([
      ["master", 2, 2],
      ["quick", 1, 0],
    ]);
    expect(list[0]!.savedAt).toBeInstanceOf(Date);
  });

  test("a run cannot start for an issue GitHub says is blocked by an open issue", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const github = new FakeGitHub();
    for (const n of [5, 6, 7]) github.issues.set(n, { number: n, title: `F0${n}`, url: `u${n}`, body: "", state: "open" });
    github.issues.get(7)!.blockedBy = [5, 6];
    await expect(startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [7] }, github)).rejects.toThrow("#7 is blocked by #5 and #6");
    github.issues.get(5)!.state = "closed";
    github.issues.get(6)!.state = "closed";
    await expect(startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [7] }, github)).resolves.toMatchObject({ status: "queued" });
  });
});

describe("the Ready gate", () => {
  const repo = { owner: "octo", name: "sample" };

  /** A project whose plan is the repository's GitHub Project; `issue` creates an issue in it with a Status. */
  async function planned() {
    const github = new FakeGitHub();
    const plan = new FakeProjects(github);
    const { number } = await plan.createProject("octo", repo, "sandbox plan");
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
    await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
    const issue = async (title: string, labels: string[], status: string | undefined, parent?: number) => {
      const created = (await plan.createIssue(repo, { project: number, title, body: "", labels, parent })).number;
      plan.itemsOf(repo).get(created)!.status = status;
      return created;
    };
    const start = (issues: number[]) => startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues }, github, plan);
    return { github, plan, issue, start };
  }

  /** The run's plan events, in order, as [type, payload]. */
  const planEvents = async (runId: string) =>
    (await db.select().from(events).where(eq(events.runId, runId)).orderBy(asc(events.seq))).filter((e) => e.type.startsWith("plan.")).map((e) => [e.type, e.payload]);

  test("starting a run on a Ready task sets it to Running and records plan.status", async () => {
    const { github, plan, issue, start } = await planned();
    const ready = await issue("Ready to build", ["task"], "Ready");
    github.issues.set(90, { number: 90, title: "Fix the crash", url: "https://github.com/octo/sample/issues/90", body: "", state: "open" });
    const run = await start([ready, 90]);
    expect(await plan.getStatus(repo, 1, ready)).toBe("Running");
    expect(await planEvents(run.id)).toEqual([
      ["plan.status", { issue: ready, status: "Running", from: "Ready" }],
      ["plan.skipped", { issue: 90, status: "Running", reason: "not-in-project" }],
    ]);
  });

  test("a status write that fails records plan.skipped and the run continues", async () => {
    const { plan, issue, start } = await planned();
    const ready = await issue("Ready to build", ["task"], "Ready");
    plan.setStatus = async () => {
      throw new Error("Resource not accessible by personal access token");
    };
    const run = await start([ready]);
    expect(run.status).toBe("queued");
    expect(await planEvents(run.id)).toEqual([["plan.skipped", { issue: ready, status: "Running", reason: "Resource not accessible by personal access token" }]]);
  });

  test("start_run refuses a task that is not Ready and names its status", async () => {
    const { issue, start } = await planned();
    const shaping = await issue("Still shaping", ["task"], "Shaping");
    const parked = await issue("Parked", ["task"], "Blocked");
    const ready = await issue("Ready to build", ["task"], "Ready");
    await expect(start([ready, shaping])).rejects.toThrow(`#${shaping} is in Shaping on the plan`);
    await expect(start([parked])).rejects.toThrow(`#${parked} is not Ready on the plan`);
    expect(await db.select().from(runs)).toEqual([]);
    await expect(start([ready])).resolves.toMatchObject({ status: "queued" });
  });

  test("start_run refuses an epic and a story", async () => {
    const { issue, start } = await planned();
    const epic = await issue("Project management", ["epic"], "Ready");
    const story = await issue("Plan read model", ["story"], "Ready", epic);
    await expect(start([epic])).rejects.toThrow(`#${epic} is an epic`);
    await expect(start([story])).rejects.toThrow(`#${story} is a story`);
    expect(await db.select().from(runs)).toEqual([]);
  });

  test("start_run starts an unplanned issue as before", async () => {
    const { github, issue, start } = await planned();
    const ready = await issue("Ready to build", ["task"], "Ready");
    github.issues.set(90, { number: 90, title: "Fix the crash", url: "https://github.com/octo/sample/issues/90", body: "It crashes", state: "open" });
    github.issues.set(91, { number: 91, title: "Fix the other crash", url: "https://github.com/octo/sample/issues/91", body: "", state: "open", blockedBy: [90] });
    const run = await start([90, ready]);
    expect(run.issues.map((i) => i.number)).toEqual([90, ready]);
    await expect(start([91])).rejects.toThrow("#91 is blocked by #90");
  });

  test("run again keeps the size of the run it repeats", async () => {
    const { plan, issue, start } = await planned();
    await plan.ensureEstimateFields("octo", 1);
    const ready = await issue("Ready to build", ["task"], "Ready");
    plan.itemsOf(repo).get(ready)!.size = "M";
    const first = await start([ready]);
    expect(first.size).toBe("M");
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.id));
    plan.itemsOf(repo).get(ready)!.size = "L";
    const again = await runAgain(db, first.id, { projects: plan });
    expect(again.size).toBe("M");
  });
});
