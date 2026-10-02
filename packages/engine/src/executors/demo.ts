import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DemoOutputSchema, LAUNCH_FILE, markNew, serverLogWarnings, uiPathsOf, type DemoWarning } from "@handoff/core";
import { and, desc, eq, ne, nodeExecutions, runs, screenshots, sql, type Db } from "@handoff/db";
import { changedFiles, isOwned } from "../contract/checks.ts";
import type { MaterializedLibrary } from "../library/materialize.ts";
import { PreviewError, startPreview, stopStepPreviews, type DockerExec } from "../preview/preview.ts";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";
import { cliNodeExecutor, type CliNodeOptions } from "./cli-node.ts";

/** The Playwright MCP server, pinned so a release does not change the demo under a running project. */
export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83";

export type DemoOptions = CliNodeOptions & {
  db: Db;
  workerId: string;
  /** Where screenshots are kept: <artifactsRoot>/<run>/<execution>/. */
  artifactsRoot: string;
  /** The browser the Playwright MCP server drives; its default (Chrome) when not given. */
  browser?: string;
  docker?: DockerExec;
};

const EMPTY_LIBRARY: MaterializedLibrary = { addDirs: [], mcpServers: [], allowedTools: [], used: { groups: [], skills: [], mcp: [], agents: [] } };

/** The origins the browser may reach: the app, by name and by address. */
function originsOf(url: string): string {
  const origin = new URL(url).origin;
  return [...new Set([origin, origin.replace("//localhost", "//127.0.0.1")])].join(";");
}

const LISTED_FILES = 10;

/**
 * The warnings of the project's latest demo in another run, which this demo's warnings are compared
 * with: a warning that was there before is not new. Undefined when the project has no such demo.
 */
async function previousDemoWarnings(db: Db, ctx: ExecutorContext): Promise<DemoWarning[] | undefined> {
  const [row] = await db
    .select({ output: nodeExecutions.output })
    .from(nodeExecutions)
    .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
    .where(
      and(
        eq(runs.projectId, ctx.project.id),
        ne(runs.id, ctx.run.id),
        eq(nodeExecutions.status, "passed"),
        sql`jsonb_typeof(${nodeExecutions.output} -> 'warnings') = 'array'`,
      ),
    )
    .orderBy(desc(nodeExecutions.finishedAt))
    .limit(1);
  return (row?.output as { warnings?: DemoWarning[] } | undefined)?.warnings;
}

/** The variable names a Demo node passes from the worker's environment to the seed command and the app. */
export const passEnvOf = (config: Record<string, unknown>): string[] => (Array.isArray(config.passEnv) ? config.passEnv.filter((n): n is string => typeof n === "string") : []);

/**
 * Why a demo set to UI changes (`config.when: "ui_changes"`) has nothing to show, or undefined when it
 * runs: the change touches no file under the project's UI paths. A demo runs for every change by default.
 */
async function skipReason(ctx: ExecutorContext, workdir: string): Promise<string | undefined> {
  if (ctx.node.config.when !== "ui_changes") return undefined;
  const paths = uiPathsOf(ctx.project.uiPaths);
  const files = await changedFiles(workdir, ctx.run.baseBranch);
  if (files.some((file) => isOwned(file, paths))) {
    // A template demos UI changes; a repository that has not said how to start its app has no demo to give.
    if (!existsSync(join(workdir, LAUNCH_FILE))) return `This repository has no ${LAUNCH_FILE}, so handoff cannot start the app to show the change. Add one to demo UI changes.`;
    return undefined;
  }
  if (!files.length) return "The change has no files, so there is nothing new to show in the app.";
  const listed = files.slice(0, LISTED_FILES).join(", ") + (files.length > LISTED_FILES ? ` and ${files.length - LISTED_FILES} more` : "");
  return `The change touches no file under the project's UI paths (${paths.join(", ")}), so there is nothing new to show in the app. It changes ${listed}.`;
}

/**
 * A Demo node: starts the run's app, then has Claude walk through each acceptance criterion in a
 * headless browser (the Playwright MCP server, which can only reach the app) and take screenshots.
 * The screenshots are copied out of the step's staging folder and recorded, so the run page, the Try it
 * gate and the pull request can show them. The app stops when the walk-through ends.
 */
export function demoExecutor(options: DemoOptions): NodeExecutor {
  const agent = cliNodeExecutor(options);
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "a demo needs the run's worktree" } };
      const reason = await skipReason(ctx, ctx.workdir.path);
      if (reason) {
        ctx.emit("demo.skipped", { reason });
        return { kind: "completed", output: { summary: reason, shots: [], skipped: true, reason } };
      }
      let preview;
      try {
        preview = await startPreview(
          { db: options.db, workerId: options.workerId },
          {
            runId: ctx.run.id,
            projectId: ctx.project.id,
            workdir: ctx.workdir,
            nodeExecutionId: ctx.execution.id,
            signal: ctx.signal,
            note: (message) => ctx.emit("preview.note", { message }),
            seedCommand: ctx.project.demoSeedCommand,
            passEnv: passEnvOf(ctx.node.config),
            ...(options.docker ? { docker: options.docker } : {}),
          },
        );
      } catch (error) {
        if (error instanceof PreviewError) return { kind: "failed", error: { code: "preview_failed", message: error.message } };
        throw error;
      }
      ctx.emit("preview.started", { id: preview.id, url: preview.url, configuration: preview.configuration });
      try {
        const shotsDir = join(ctx.stagingDir, "screenshots");
        mkdirSync(shotsDir, { recursive: true });
        const library = ctx.library ?? EMPTY_LIBRARY;
        const servers = library.mcpConfigPath ? (JSON.parse(readFileSync(library.mcpConfigPath, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers : {};
        const args = ["-y", PLAYWRIGHT_MCP, "--headless", "--isolated", "--output-dir", shotsDir, "--allowed-origins", originsOf(preview.url)];
        if (options.browser) args.push("--browser", options.browser);
        const mcpConfigPath = join(ctx.stagingDir, "demo-mcp.json");
        writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { ...servers, playwright: { command: "npx", args } } }, null, 2), { mode: 0o600 });

        const outcome = await agent.execute({
          ...ctx,
          library: { ...library, mcpConfigPath, mcpServers: [...library.mcpServers, "playwright"] },
          packet: { ...ctx.packet, app: { url: preview.url } },
        });
        if (outcome.kind !== "completed") return outcome;

        // Only handoff skips a demo: whatever the agent says, it walked through the app.
        const { skipped: _skipped, reason: _reason, warnings: _warnings, ...output } = DemoOutputSchema.parse(outcome.output);
        const errors = output.console.filter((entry) => entry.level === "error");
        if (errors.length) {
          const count = errors.length === 1 ? "an error" : `${errors.length} errors`;
          const message = `The browser console had ${count} while the demo walked through the app:\n${errors.map((e) => `- ${e.text}`).join("\n")}`;
          return { kind: "failed", error: { code: "demo_console_errors", message, detail: { console: output.console } }, ...(outcome.cost ? { cost: outcome.cost } : {}) };
        }
        const dir = join(options.artifactsRoot, ctx.run.id, ctx.execution.id);
        mkdirSync(dir, { recursive: true });
        const kept: typeof output.shots = [];
        for (const shot of output.shots) {
          const file = basename(shot.file);
          const source = join(shotsDir, file);
          if (!existsSync(source)) {
            ctx.emit("demo.missing_shot", { file });
            continue;
          }
          const path = join(dir, `${kept.length}-${file}`);
          copyFileSync(source, path);
          const [row] = await options.db
            .insert(screenshots)
            .values({ runId: ctx.run.id, nodeExecutionId: ctx.execution.id, position: kept.length, path, caption: shot.caption, criterion: shot.criterion ?? null, works: shot.works })
            .returning({ id: screenshots.id });
          kept.push({ ...shot, artifactId: row!.id });
        }
        const current = [...serverLogWarnings(existsSync(preview.logPath) ? readFileSync(preview.logPath, "utf8") : ""), ...output.console.map((e) => ({ source: "console" as const, ...e }))];
        const warnings = markNew(current, await previousDemoWarnings(options.db, ctx));
        return { ...outcome, output: { ...output, shots: kept, warnings } };
      } finally {
        await stopStepPreviews(options.db, ctx.execution.id);
      }
    },
  };
}
