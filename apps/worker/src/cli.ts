import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { compileGraph } from "@handoff/core";
import { and, desc, eq, graphs, graphVersions, listEventsAfter, listLibrary, nodeExecutions, projects, runs, sql, upsertSkill, type Db } from "@handoff/db";
import { answerQuestion, cancelRun, createRun, repairNodeExecution } from "@handoff/engine";
import { gitHubFromEnv, type GitHubPort } from "@handoff/github";
import { gcClaudeSessions } from "./gc.ts";

/** github: undefined reads credentials from the environment; null skips GitHub (tests). */
export type CliIo = { db: Db; out: (line: string) => void; webUrl?: string; github?: GitHubPort | null };

const USAGE = `usage:
  handoff project add --name <name> --repo <owner/name> [--branch <default>] [--clone <path>]
  handoff graph import --project <name> --name <graph> <file.json>
  handoff run --project <name> --graph <graph> --task "<task>" [--follow]
  handoff runs
  handoff run cancel <runId>
  handoff run repair <runId> --node <key> [--note "<text>"]
  handoff answer <questionId> "<answer>" [--option <option>]
  handoff library import-skill <dir-with-SKILL.md>
  handoff library list
  handoff gc [--days 7]`;

function readSkillDir(dir: string) {
  const raw = readFileSync(join(dir, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  const meta = Object.fromEntries(
    (match?.[1] ?? "")
      .split("\n")
      .map((line) => /^([a-zA-Z_-]+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!.replace(/^["']|["']$/g, "")]),
  );
  const files: { path: string; content: string }[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full !== join(dir, "SKILL.md") && statSync(full).size < 512 * 1024) files.push({ path: relative(dir, full), content: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return { name: meta.name ?? basename(dir), description: meta.description ?? "", body: (match?.[2] ?? raw).trim(), files };
}

function need(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || value === "") throw new Error(`--${key} is required\n${USAGE}`);
  return value;
}

async function projectByName(db: Db, name: string) {
  const [project] = await db.select().from(projects).where(eq(projects.name, name));
  if (!project) throw new Error(`no project named ${name}; add it with: handoff project add`);
  return project;
}

export async function runCli(argv: string[], io: CliIo): Promise<void> {
  const [command, sub, ...rest] = argv;
  const { db, out } = io;

  if (command === "project" && sub === "add") {
    const { values } = parseArgs({ args: rest, options: { name: { type: "string" }, repo: { type: "string" }, branch: { type: "string" }, clone: { type: "string" } } });
    const [owner, repoName] = need(values, "repo").split("/");
    if (!owner || !repoName) throw new Error("--repo must look like owner/name");
    const github = io.github === undefined ? gitHubFromEnv() : io.github ?? undefined;
    const repoId = github ? await github.getRepoId({ owner, name: repoName }).catch(() => {
      throw new Error(`GitHub cannot find ${owner}/${repoName} with the configured credentials`);
    }) : null;
    const [project] = await db
      .insert(projects)
      .values({ name: need(values, "name"), repoOwner: owner, repoName, repoId, defaultBranch: values.branch ?? "main", localClonePath: values.clone ?? null })
      .onConflictDoUpdate({
        target: projects.name,
        set: { repoOwner: owner, repoName, repoId, defaultBranch: values.branch ?? "main", localClonePath: values.clone ?? null },
      })
      .returning();
    out(`project ${project!.name}: ${owner}/${repoName} (default branch ${project!.defaultBranch})`);
    return;
  }

  if (command === "graph" && sub === "import") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { project: { type: "string" }, name: { type: "string" } } });
    const file = positionals[0];
    if (!file) throw new Error(`graph file is required\n${USAGE}`);
    const document = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const compiled = compileGraph(document);
    if (!compiled.ok) throw new Error(`graph does not compile:\n${compiled.errors.map((e) => `  ${e.code}: ${e.message}`).join("\n")}`);
    const project = await projectByName(db, need(values, "project"));
    const name = need(values, "name");
    const version = await db.transaction(async (tx) => {
      const [graph] = await tx
        .insert(graphs)
        .values({ projectId: project.id, name, latestVersion: 1 })
        .onConflictDoUpdate({ target: [graphs.projectId, graphs.name], set: { latestVersion: sql`${graphs.latestVersion} + 1` } })
        .returning();
      const [row] = await tx
        .insert(graphVersions)
        .values({ graphId: graph!.id, version: graph!.latestVersion, document: document as Record<string, unknown>, createdBy: "cli" })
        .returning();
      return row!;
    });
    out(`graph ${name} version ${version.version} imported for ${project.name}`);
    return;
  }

  if (command === "run" && sub === "cancel") {
    const runId = rest[0];
    if (!runId) throw new Error(USAGE);
    await cancelRun(db, runId, { reason: "cancelled from the CLI" });
    out(`run ${runId} cancelled`);
    return;
  }

  if (command === "run" && sub === "repair") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { node: { type: "string" }, note: { type: "string" } } });
    const runId = positionals[0];
    if (!runId) throw new Error(USAGE);
    const [failed] = await db
      .select()
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeKey, need(values, "node")), eq(nodeExecutions.status, "failed")))
      .orderBy(desc(nodeExecutions.attempt))
      .limit(1);
    if (!failed) throw new Error(`no failed execution of ${values.node} in run ${runId}`);
    const created = await repairNodeExecution(db, failed.id, values.note ? { note: values.note } : {});
    out(`repair queued: ${created.nodeKey} attempt ${created.attempt}`);
    return;
  }

  if (command === "answer") {
    const { values, positionals } = parseArgs({ args: [sub ?? "", ...rest], allowPositionals: true, options: { option: { type: "string" } } });
    const [questionId, answer] = positionals;
    if (!questionId || !answer) throw new Error(USAGE);
    await answerQuestion(db, questionId, { answer, answeredBy: "cli", ...(values.option ? { option: values.option } : {}) });
    out(`question ${questionId} answered`);
    return;
  }

  if (command === "run" && (sub === undefined || sub.startsWith("--"))) {
    const args = sub ? [sub, ...rest] : rest;
    const { values } = parseArgs({ args, options: { project: { type: "string" }, graph: { type: "string" }, task: { type: "string" }, follow: { type: "boolean" } } });
    const project = await projectByName(db, need(values, "project"));
    const graphName = need(values, "graph");
    const [version] = await db
      .select({ id: graphVersions.id, version: graphVersions.version })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(and(eq(graphs.projectId, project.id), eq(graphs.name, graphName)))
      .orderBy(desc(graphVersions.version))
      .limit(1);
    if (!version) throw new Error(`no graph named ${graphName} for ${project.name}; import one with: handoff graph import`);
    const run = await createRun(db, { projectId: project.id, graphVersionId: version.id, task: need(values, "task") });
    out(`run ${run.id} queued on branch ${run.branchName}`);
    out(`${io.webUrl ?? "http://localhost:3000"}/runs/${run.id}`);
    if (values.follow) await follow(db, run.id, out);
    return;
  }

  if (command === "library" && sub === "import-skill") {
    const dir = rest[0];
    if (!dir) throw new Error(USAGE);
    const skill = await upsertSkill(db, readSkillDir(dir));
    out(`skill ${skill.name} version ${skill.version} (${skill.files.length} supporting files)`);
    return;
  }

  if (command === "library" && sub === "list") {
    const { skills, mcp, agents } = await listLibrary(db);
    for (const s of skills) out(`skill  ${s.name} v${s.version}  ${s.description}`);
    for (const m of mcp) out(`mcp    ${m.name} v${m.version}  ${m.transport}`);
    for (const a of agents) out(`agent  ${a.name} v${a.version}  ${a.description}`);
    return;
  }

  if (command === "gc") {
    const { values } = parseArgs({ args: [sub ?? "", ...rest].filter(Boolean), options: { days: { type: "string" } } });
    const removed = await gcClaudeSessions(db, { home: process.env.HANDOFF_HOME ?? "./.handoff", olderThanDays: Number(values.days ?? 7) });
    out(`removed ${removed.length} Claude session folders`);
    return;
  }

  if (command === "runs") {
    const rows = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(20);
    for (const r of rows) out(`${r.id}  ${r.status.padEnd(9)}  ${r.task}`);
    return;
  }

  throw new Error(USAGE);
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

async function follow(db: Db, runId: string, out: (line: string) => void) {
  let cursor = 0;
  for (;;) {
    const events = await listEventsAfter(db, runId, cursor, 200);
    for (const e of events) {
      if (!e.type.startsWith("cli.")) out(`${String(e.seq).padStart(4)} ${e.type} ${JSON.stringify(e.payload).slice(0, 160)}`);
      cursor = e.seq;
    }
    const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
    if (run && TERMINAL.has(run.status) && events.length === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (import.meta.main) {
  const { createDb } = await import("@handoff/db");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createDb(url);
  try {
    await runCli(process.argv.slice(2), { db, out: (line) => console.log(line), ...(process.env.WEB_URL ? { webUrl: process.env.WEB_URL } : {}) });
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
