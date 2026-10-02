import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

/**
 * One way to start the app, as `.claude/launch.json` describes it: the file Claude Code desktop reads
 * for its Preview (https://code.claude.com/docs/en/desktop). Either a command (`runtimeExecutable` and
 * `runtimeArgs`) or a node script (`program` and `args`).
 */
export const LaunchConfigurationSchema = z.object({
  name: z.string().min(1),
  runtimeExecutable: z.string().min(1).optional(),
  runtimeArgs: z.array(z.string()).default([]),
  program: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  /** The port the app listens on; 3000 when not given. */
  port: z.number().int().positive().default(3000),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  /** false: the app must have this exact port. Otherwise any free port, passed in PORT. */
  autoPort: z.boolean().optional(),
  /** Where the preview opens instead of http://localhost:<port>. */
  url: z.string().optional(),
});
export type LaunchConfiguration = z.infer<typeof LaunchConfigurationSchema>;

export const LaunchFileSchema = z.object({ configurations: z.array(LaunchConfigurationSchema).min(1) }).loose();
export type LaunchFile = z.infer<typeof LaunchFileSchema>;

/** Where a repository keeps its launch file, relative to its root. */
export const LAUNCH_FILE = ".claude/launch.json";

/** The configuration a project names for handoff's demos, such as its production build. */
export const DEMO_CONFIGURATION = "handoff-demo";

/** The configuration handoff starts: the one named handoff-demo when there is one, else the first. */
export function demoConfiguration(launch: LaunchFile): LaunchConfiguration {
  return launch.configurations.find((c) => c.name === DEMO_CONFIGURATION) ?? launch.configurations[0]!;
}

/** Parses a launch file, which may hold comments and trailing commas. Throws saying what is wrong. */
export function parseLaunchFile(text: string): LaunchFile {
  const errors: ParseError[] = [];
  const json: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${LAUNCH_FILE} is not valid JSON: ${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}`);
  const result = LaunchFileSchema.safeParse(json);
  if (!result.success) throw new Error(`${LAUNCH_FILE}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  for (const c of result.data.configurations) {
    if (!c.runtimeExecutable && !c.program) throw new Error(`${LAUNCH_FILE}: configuration ${c.name} needs runtimeExecutable or program`);
  }
  return result.data;
}

/** `rel` under `root` with `.` and `..` resolved, or undefined when it leaves `root`. Core stays free of node:path, since browsers load it. */
function inside(root: string, rel: string): string | undefined {
  if (rel.startsWith("/")) return undefined;
  const parts: string[] = [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return [root.replace(/\/+$/, ""), ...parts].join("/");
}

/** The process that runs a configuration in a run's worktree, on `port`, and where it is reached. */
export type PreviewCommand = { command: string; args: string[]; cwd: string; env: Record<string, string>; url: string };

/**
 * How to start a configuration in the worktree at `root` on `port`. The port goes to the app in PORT,
 * as Claude Code desktop passes it, and replaces the port in the address the preview opens.
 */
export function previewCommand(config: LaunchConfiguration, { root, port }: { root: string; port: number }): PreviewCommand {
  const cwd = inside(root, (config.cwd ?? ".").replace("${workspaceFolder}", "."));
  if (cwd === undefined) throw new Error(`${LAUNCH_FILE}: configuration ${config.name} has a cwd outside the repository`);
  const [command, args] = config.program ? ["node", [config.program, ...config.args]] : [config.runtimeExecutable!, config.runtimeArgs];
  const url = new URL(config.url ?? "http://localhost");
  url.port = String(port);
  const address = config.url ? url.toString() : url.origin;
  return { command, args, cwd, env: { ...config.env, PORT: String(port) }, url: address };
}
