/**
 * A project's permission timeout in minutes: how long a step waits for an answer to a permission request
 * before it is denied and the step goes on. The projects column's default and check match it.
 */
export const PERMISSION_TIMEOUT_MINUTES = { min: 1, max: 120, default: 10 } as const;

/** What a permission request asks, in words. */
export type PermissionDescription = {
  /** The action, for a title: "asks to run a command". */
  action: string;
  /** What the agent said the call is for, when the tool takes a description (Bash and Monitor do). */
  description?: string;
  /** What a person checks: the command, the file, or short key: value pairs of the input. */
  target: string;
  /** The description and the target, one per line. */
  detail: string;
  /** The description and the target on one line, for a notification to cut to fit. */
  summary: string;
};

const VALUE_MAX = 60;

const cut = (value: string) => (value.length <= VALUE_MAX ? value : `${value.slice(0, VALUE_MAX - 1)}…`);

/** The input's values as short key: value pairs, the description left out because it is shown on its own. */
function pairs(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([key, value]) => key !== "description" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${cut(typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value))}`)
    .join(", ");
}

/**
 * What a permission request asks, readable instead of the raw input: the agent's description of the
 * call when the tool has one, then the command for Bash and Monitor, the path for file tools, the URL or
 * query for web tools, and short key: value pairs for any other tool. The card, notifications, the
 * attention list and get_run all describe a request with this.
 */
export function describePermission(toolName: string, input: Record<string, unknown>): PermissionDescription {
  const text = (key: string) => (typeof input[key] === "string" && (input[key] as string).trim() ? (input[key] as string) : undefined);
  const [action, target] = ((): [string, string | undefined] => {
    if (toolName === "Bash") return ["asks to run a command", text("command")];
    if (toolName === "Monitor") return ["asks to use Monitor", text("command")];
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit" || toolName === "NotebookEdit") return ["asks to change a file", text("file_path") ?? text("notebook_path")];
    if (toolName === "Read") return ["asks to read a file", text("file_path")];
    if (toolName === "WebFetch") return ["asks to fetch a page", text("url")];
    if (toolName === "WebSearch") return ["asks to search the web", text("query")];
    return [`asks to use ${toolName}`, undefined];
  })();
  const description = text("description")?.trim();
  const shown = target ?? pairs(input);
  const parts = [description, shown].filter((p): p is string => !!p);
  return { action, ...(description ? { description } : {}), target: shown, detail: parts.join("\n"), summary: parts.join(" · ") };
}

/** Programs whose second word is a subcommand that decides what they do, so a rule names both. */
const WITH_SUBCOMMANDS = new Set(["git", "pnpm", "npm", "npx", "yarn", "bun", "gh", "docker", "cargo", "go", "uv", "pip", "kubectl"]);

/** Programs that run whatever follows them: a rule for one would allow any command. */
const NEVER = new Set(["cd", "node", "sh", "bash", "zsh", "env", "eval", "exec", "sudo", "xargs", "python", "python3"]);

/** Claude Code's command separators: it matches each part of a compound command against the rules on its own. */
const SEPARATORS = /&&|\|\||\|&|[;|&\n]/;

/** A simple command's words, without the variable assignments in front of its program. */
function wordsOf(command: string): string[] {
  const words = command.trim().split(/\s+/).filter(Boolean);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  return words;
}

/** The rule for one simple command: its program, or its program and subcommand, with any arguments. */
function commandRule(command: string): string | undefined {
  const [program, subcommand] = wordsOf(command);
  if (!program || NEVER.has(program)) return undefined;
  if (!WITH_SUBCOMMANDS.has(program)) return `Bash(${program} *)`;
  // An option before the subcommand (git -C dir log) leaves no rule short of every command of the program.
  if (!subcommand || !/^[A-Za-z][\w:.-]*$/.test(subcommand)) return undefined;
  return `Bash(${program} ${subcommand} *)`;
}

const isCd = (part: string) => /^cd(\s|$)/.test(part);

/**
 * The allow rule that would cover this call from now on: a command's program with any arguments (its
 * subcommand too, for programs such as git and pnpm), or the tool itself. It goes into the node's allow
 * list in the graph's next version, and the run's own list. Undefined when no rule is safe to offer: for
 * cd, node, a shell or env, which would allow anything, or an option before a subcommand. In a compound
 * command a leading cd needs no rule, and the rule is for the first command after it.
 */
export function ruleFor(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== "Bash" || typeof input.command !== "string") return toolName;
  const parts = input.command.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const first = parts.find((p) => !isCd(p)) ?? parts[0];
  return first ? commandRule(first) : undefined;
}

/** Whether a Bash rule, such as `Bash(git log *)` or `Bash(pnpm test)`, covers one simple command. */
function bashRuleCovers(rule: string, part: string): boolean {
  const pattern = /^Bash\((.+)\)$/.exec(rule)?.[1];
  if (!pattern || pattern === "*") return pattern === "*";
  const command = wordsOf(part).join(" ");
  if (!pattern.endsWith(" *")) return command === pattern;
  const prefix = pattern.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
}

/**
 * The rule among a run's Always allow rules that covers this call, read the way Claude Code reads its
 * allow rules, or undefined. A rule without parentheses covers every call of its tool. A Bash rule covers
 * a command when it covers each part of it, a cd in front aside; Monitor's commands follow the Bash rules.
 * A command with a command inside it ($() or backticks), or an operator with nothing after it, is never
 * covered: a person looks at it.
 */
export function allowedBy(rules: string[], toolName: string, input: Record<string, unknown>): string | undefined {
  const whole = rules.find((rule) => rule === toolName || rule === `${toolName}(*)`);
  if (whole) return whole;
  if ((toolName !== "Bash" && toolName !== "Monitor") || typeof input.command !== "string") return undefined;
  const command = input.command.trim();
  if (/\$\(|`/.test(command) || /(&&|\|\||[;|&])\s*$/.test(command)) return undefined;
  const parts = command.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const run = parts.filter((p) => !isCd(p));
  if (run.length === 0) return undefined;
  const covering = run.map((part) => rules.find((rule) => bashRuleCovers(rule, part)));
  return covering.every(Boolean) ? covering[0] : undefined;
}
