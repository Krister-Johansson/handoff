import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, listLibraryIndex, nodeExecutions, projects, type Db } from "@handoff/db";
import { answerQuestion, cancelRun, repairNodeExecution } from "@handoff/engine/operations";
import type { GitHubPort } from "@handoff/github";
import { listAttention } from "./attention";
import { isTodo, listBacklog } from "./backlog";
import { createProject, getProjectDetail, listProjects, runAgain, startRunFromGraph } from "./graphs";
import { getRunDetail, listRuns } from "./queries";

export type HandoffMcpDeps = { db: Db; github: GitHubPort | undefined; baseUrl: string };

const INSTRUCTIONS = `handoff runs graphs of coding agents on GitHub repositories. A project is a repository; its backlog is the open issues no run works on yet.

To work on issues: list_backlog, then start_run with the issue numbers (the task can stay empty), then get_run to follow the run. Every result links to the dashboard.

A run may stop to ask a question (a Human gate) or fail. Tell the user what it asks or why it failed. Answer a question only with the user's decision, and ask before cancelling a run; repairing re-runs the failed step.`;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Runs a tool body, turning a thrown error into a tool error the agent can read. */
async function tool(body: () => Promise<unknown>) {
  try {
    return json(await body());
  } catch (error) {
    return fail((error as Error).message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A project by name or id. */
async function findProject(db: Db, ref: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(UUID.test(ref) ? eq(projects.id, ref) : eq(projects.name, ref));
  if (!project) throw new Error(`There is no project ${ref}. list_projects shows the projects.`);
  return project;
}

const errorMessage = (error: unknown) => (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : undefined);

/** A run as the agent needs it: where it stands, its steps, PR, issues, open questions and failure. */
async function runSummary(deps: HandoffMcpDeps, runId: string) {
  const detail = await getRunDetail(deps.db, runId);
  if (!detail) throw new Error(`There is no run ${runId}.`);
  const { run, project, executions, openQuestions, failed, graph } = detail;
  return {
    id: run.id,
    project: project.name,
    graph: graph?.name,
    task: run.task,
    status: run.status,
    url: `${deps.baseUrl}/runs/${run.id}`,
    branch: run.branchName,
    pr: run.prNumber ? { number: run.prNumber, url: `https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}` } : null,
    issues: run.issues.map((i) => ({ number: i.number, title: i.title, url: i.url })),
    steps: executions.map((e) => ({ node: e.nodeKey, attempt: e.attempt, status: e.status })),
    questions: openQuestions.map((q) => {
      const review = (q.context as { review?: { markdown?: string } }).review;
      return {
        id: q.id,
        node: q.nodeKey,
        question: q.question,
        options: q.options ?? [],
        // A review shows what to approve; the person can also comment on it in the dashboard.
        ...(review?.markdown ? { review: review.markdown, review_url: `${deps.baseUrl}/runs/${run.id}/review/${q.id}` } : {}),
      };
    }),
    failed: failed ? { node: failed.nodeKey, attempt: failed.attempt, error: errorMessage(failed.error) } : null,
  };
}

/**
 * handoff's operations as MCP tools, for an agent such as the user's Claude Code session. Each tool
 * calls the same server functions the dashboard uses.
 */
export function createHandoffMcpServer(deps: HandoffMcpDeps): McpServer {
  const { db, github, baseUrl } = deps;
  const server = new McpServer({ name: "handoff", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool("list_projects", { description: "The projects: each is a GitHub repository with graphs and runs.", annotations: read }, () =>
    tool(async () =>
      (await listProjects(db)).map((p) => ({
        name: p.name,
        id: p.id,
        repo: `${p.repoOwner}/${p.repoName}`,
        default_branch: p.defaultBranch,
        runs: p.runCount,
        active_runs: p.activeRuns,
        url: `${baseUrl}/projects/${p.id}`,
      })),
    ),
  );

  server.registerTool(
    "add_project",
    {
      description: "Adds a GitHub repository as a handoff project. Runs branch off its default branch; new projects have no graph until one is created on the project's Settings tab.",
      inputSchema: {
        repo: z.string().describe("owner/name on GitHub"),
        name: z.string().optional().describe("Project name; defaults to the repository's"),
        default_branch: z.string().optional().describe("Defaults to the repository's default branch"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ repo, name, default_branch }) =>
      tool(async () => {
        const known = (await listProjects(db)).find((p) => `${p.repoOwner}/${p.repoName}`.toLowerCase() === repo.toLowerCase());
        if (known) throw new Error(`${repo} is already a project: ${known.name}.`);
        const listed = default_branch ? undefined : (await github?.listRepos().catch(() => []))?.find((r) => r.fullName.toLowerCase() === repo.toLowerCase());
        const project = await createProject(db, { repo, defaultBranch: default_branch ?? listed?.defaultBranch ?? "main", ...(name ? { name } : {}) }, github);
        return { name: project.name, id: project.id, repo: `${project.repoOwner}/${project.repoName}`, default_branch: project.defaultBranch, url: `${baseUrl}/projects/${project.id}` };
      }),
  );

  server.registerTool(
    "get_project",
    { description: "A project's graphs, the graph new runs use by default, and its latest runs.", inputSchema: { project: z.string().describe("Project name or id") }, annotations: read },
    ({ project }) =>
      tool(async () => {
        const detail = await getProjectDetail(db, (await findProject(db, project)).id);
        if (!detail) throw new Error(`There is no project ${project}.`);
        return {
          name: detail.project.name,
          repo: `${detail.project.repoOwner}/${detail.project.repoName}`,
          graphs: detail.graphs.map((g) => g.name),
          default_graph: detail.defaultGraph ?? null,
          recent_runs: detail.runs.slice(0, 10).map((r) => ({ id: r.id, task: r.task, status: r.status, url: `${baseUrl}/runs/${r.id}` })),
        };
      }),
  );

  server.registerTool(
    "list_backlog",
    {
      description: "The project's open GitHub issues that no run works on yet, newest activity first. With include_started, also issues a run already took.",
      inputSchema: { project: z.string().describe("Project name or id"), include_started: z.boolean().optional() },
      annotations: read,
    },
    ({ project, include_started }) =>
      tool(async () => {
        const backlog = await listBacklog(db, github, (await findProject(db, project)).id);
        if ("error" in backlog) throw new Error(backlog.error);
        return backlog.issues
          .filter((issue) => include_started || isTodo(issue))
          .map((issue) => ({
            number: issue.number,
            title: issue.title,
            url: issue.url,
            labels: issue.labels,
            run: issue.run ? { id: issue.run.id, status: issue.run.status, url: `${baseUrl}/runs/${issue.run.id}` } : null,
          }));
      }),
  );

  server.registerTool(
    "start_run",
    {
      description: "Starts a run on the project. Link issues by number (their bodies go to the agents) and leave the task empty to use their titles, or describe a task.",
      inputSchema: {
        project: z.string().describe("Project name or id"),
        issues: z.array(z.number().int().positive()).optional().describe("GitHub issue numbers the run works on"),
        task: z.string().optional().describe("What to do; defaults to the issues' titles"),
        graph: z.string().optional().describe("Graph name; defaults to the one the project's latest run used"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ project, issues, task, graph }) =>
      tool(async () => {
        const detail = await getProjectDetail(db, (await findProject(db, project)).id);
        const graphName = graph ?? detail?.defaultGraph;
        if (!detail || !graphName) throw new Error(`${project} has no graph yet. Create one on its Settings tab.`);
        if (!issues?.length && (task ?? "").trim().length < 5) throw new Error("Link at least one issue or describe the task.");
        const run = await startRunFromGraph(db, { projectId: detail.project.id, graphName, task: task ?? "", issues: issues ?? [] }, github);
        return { run_id: run.id, status: run.status, graph: graphName, branch: run.branchName, url: `${baseUrl}/runs/${run.id}` };
      }),
  );

  server.registerTool(
    "list_runs",
    {
      description: "Runs, newest first. status active means queued, running or waiting.",
      inputSchema: { project: z.string().optional().describe("Project name"), status: z.enum(["active", "succeeded", "failed", "cancelled"]).optional() },
      annotations: read,
    },
    ({ project, status }) =>
      tool(async () =>
        (await listRuns(db, { ...(project ? { project } : {}), ...(status ? { status } : {}) }, 30)).map((r) => ({
          id: r.id,
          project: r.project,
          task: r.task,
          status: r.status,
          pr: r.prNumber,
          issues: r.issues.map((i) => i.number),
          created_at: r.createdAt,
          url: `${baseUrl}/runs/${r.id}`,
        })),
      ),
  );

  server.registerTool(
    "get_run",
    { description: "Where a run stands: status, steps, PR, linked issues, open questions and the failed step.", inputSchema: { run_id: z.string() }, annotations: read },
    ({ run_id }) => tool(() => runSummary(deps, run_id)),
  );

  server.registerTool(
    "list_attention",
    { description: "Everything waiting on a person: questions from Human gates, failed runs, pull requests waiting for review.", annotations: read },
    () => tool(async () => (await listAttention(db)).map(({ href, ...item }) => ({ ...item, url: `${baseUrl}${href}` }))),
  );

  server.registerTool(
    "answer_question",
    {
      description: "Answers a question a run asked, which lets it continue. Only answer with the user's decision.",
      inputSchema: {
        question_id: z.string(),
        answer: z.string().min(1),
        option: z.string().optional().describe("One of the question's options, when it has them: approve or changes for a review"),
        comments: z
          .array(z.object({ quote: z.string().optional().describe("The passage the comment is about"), body: z.string() }))
          .optional()
          .describe("For a review: comments on quoted passages, sent back with changes"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ question_id, answer, option, comments }) =>
      tool(async () => {
        const row = await answerQuestion(db, question_id, { answer, ...(option ? { option } : {}), ...(comments?.length ? { comments } : {}), answeredBy: "claude-code" });
        return { answered: true, run_id: row.runId, url: `${baseUrl}/runs/${row.runId}` };
      }),
  );

  server.registerTool(
    "repair_run",
    {
      description: "Re-runs the failed step of a failed run in place, keeping what earlier steps did. A note is passed to the step's agent.",
      inputSchema: { run_id: z.string(), node: z.string().optional().describe("The failed step; defaults to the one that failed last"), note: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ run_id, node, note }) =>
      tool(async () => {
        const [failed] = await db
          .select({ id: nodeExecutions.id, nodeKey: nodeExecutions.nodeKey })
          .from(nodeExecutions)
          .where(and(eq(nodeExecutions.runId, run_id), eq(nodeExecutions.status, "failed"), node ? eq(nodeExecutions.nodeKey, node) : undefined))
          .orderBy(desc(nodeExecutions.attempt), desc(nodeExecutions.createdAt))
          .limit(1);
        if (!failed) throw new Error(node ? `No failed ${node} step in run ${run_id}.` : `Run ${run_id} has no failed step.`);
        const retry = await repairNodeExecution(db, failed.id, note ? { note } : {});
        return { node: retry.nodeKey, attempt: retry.attempt, url: `${baseUrl}/runs/${run_id}` };
      }),
  );

  server.registerTool(
    "cancel_run",
    { description: "Cancels a run. Ask the user first.", inputSchema: { run_id: z.string(), reason: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
    ({ run_id, reason }) =>
      tool(async () => {
        await cancelRun(db, run_id, reason ? { reason } : {});
        return { cancelled: true, url: `${baseUrl}/runs/${run_id}` };
      }),
  );

  server.registerTool(
    "run_again",
    { description: "Starts a finished run's task again on the latest version of its graph.", inputSchema: { run_id: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
    ({ run_id }) =>
      tool(async () => {
        const run = await runAgain(db, run_id);
        return { run_id: run.id, status: run.status, url: `${baseUrl}/runs/${run.id}` };
      }),
  );

  server.registerTool("list_library", { description: "Skills, MCP servers, agents and groups nodes can enable by name.", annotations: read }, () =>
    tool(async () => {
      const { skills, mcp, agents, groups } = await listLibraryIndex(db);
      return {
        skills: skills.map((s) => ({ name: s.name, description: s.description })),
        mcp: mcp.map((m) => ({ name: m.name, url: m.url, tools: m.tools })),
        agents: agents.map((a) => ({ name: a.name, description: a.description })),
        groups: groups.map((g) => ({ name: g.name, description: g.description })),
      };
    }),
  );

  return server;
}
