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

/** The name of the configuration a project's App launch setting holds, as handoff records it and copies it to a file. */
export const SETTING_CONFIGURATION = "app";

/**
 * A command line split into words as a POSIX shell splits it, without running a shell: single and double
 * quotes keep a word whole, and a backslash escapes the next character outside single quotes. Throws when
 * a quote is not closed.
 */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else word = (word ?? "") + ch;
    } else if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1]!)) word = (word ?? "") + line[++i]!;
      else word = (word ?? "") + ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (ch === "\\" && i + 1 < line.length) {
      word = (word ?? "") + line[++i]!;
    } else if (/\s/.test(ch)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? "") + ch;
    }
  }
  if (quote) throw new Error(`The command has a ${quote === "'" ? "single" : "double"} quote that is not closed.`);
  if (word !== undefined) words.push(word);
  return words;
}

/** A word as a shell reads it back: as it is when plain, else in single quotes. */
const quoteWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** The words a configuration runs, program first: `node <program> <args>` for a node script. */
const commandWords = (config: LaunchConfiguration) => (config.program ? ["node", config.program, ...config.args] : [config.runtimeExecutable!, ...config.runtimeArgs]);

/** A configuration's command as one line, which splitCommand turns back into the same words. */
export const commandLine = (config: LaunchConfiguration) => commandWords(config).map(quoteWord).join(" ");

/** The App launch form in Project settings, as typed: one configuration, the command on one line. */
export type LaunchForm = { command: string; cwd: string; port: string; anyPort: boolean; url: string; env: { name: string; value: string }[] };
export type LaunchFormField = "command" | "cwd" | "port" | "url" | "env";
export type LaunchFormResult = { ok: true; configuration: LaunchConfiguration } | { ok: false; errors: Partial<Record<LaunchFormField, string>> };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The form as a launch configuration, or what to fix in each field. Empty environment rows are dropped. */
export function configurationFromForm(form: LaunchForm): LaunchFormResult {
  const errors: Partial<Record<LaunchFormField, string>> = {};
  let words: string[] = [];
  try {
    words = splitCommand(form.command);
    if (words.length === 0) errors.command = "Type the command that starts the app, such as pnpm dev.";
  } catch (error) {
    errors.command = (error as Error).message;
  }
  const cwd = form.cwd.trim().replace(/^\.\/?$/, "");
  if (cwd && inside("/r", cwd) === undefined) errors.cwd = "The working directory is a path inside the repository, such as apps/web.";
  const port = Number(form.port.trim());
  if (!/^\d+$/.test(form.port.trim()) || port < 1 || port > 65535) errors.port = "The port is a whole number from 1 to 65535.";
  const url = form.url.trim();
  if (url && !/^https?:\/\/[^/\s]+/.test(url)) errors.url = "Opens at is an http:// or https:// address, such as http://localhost:3000/shop.";
  const rows = form.env.map((r) => ({ name: r.name.trim(), value: r.value })).filter((r) => r.name || r.value);
  const env: Record<string, string> = {};
  for (const { name } of rows) {
    if (!ENV_NAME.test(name)) errors.env ??= `${name || "A variable"} is not a variable name: use letters, digits and _, not starting with a digit.`;
    else if (name === "PORT") errors.env ??= "Handoff sets PORT itself; leave it out.";
    else if (name in env) errors.env ??= `${name} is there twice.`;
    else env[name] = rows.find((r) => r.name === name)!.value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const [program, ...args] = words;
  return {
    ok: true,
    configuration: {
      name: SETTING_CONFIGURATION,
      runtimeExecutable: program!,
      runtimeArgs: args,
      args: [],
      ...(cwd ? { cwd } : {}),
      port,
      ...(form.anyPort ? {} : { autoPort: false }),
      ...(url ? { url } : {}),
      env,
    },
  };
}

/** A configuration as the form shows it. */
export function formFromConfiguration(config: LaunchConfiguration): LaunchForm {
  return {
    command: commandLine(config),
    cwd: config.cwd ?? "",
    port: String(config.port),
    anyPort: config.autoPort !== false,
    url: config.url ?? "",
    env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
  };
}

/** A launch file holding one configuration, as Copy as launch.json gives it: the fields a file needs, nothing empty. */
export function launchFileText(config: LaunchConfiguration): string {
  const { name, runtimeExecutable, runtimeArgs, program, args, cwd, port, autoPort, url, env } = config;
  const entry = {
    name,
    ...(program ? { program, ...(args.length ? { args } : {}) } : { runtimeExecutable, runtimeArgs }),
    ...(cwd ? { cwd } : {}),
    port,
    ...(autoPort === false ? { autoPort } : {}),
    ...(url ? { url } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
  return `${JSON.stringify({ version: "0.0.1", configurations: [entry] }, null, 2)}\n`;
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
