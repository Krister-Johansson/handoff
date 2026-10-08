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

/**
 * Shell keywords in front of a simple command: the words after them are the command that runs. A
 * while, until, if or elif header is the command it checks, so `while read x` needs a rule for read.
 */
const KEYWORDS = new Set(["do", "then", "else", "elif", "!", "while", "until", "if"]);

/** Keywords that end a loop or a check: on their own they run nothing. */
const CLOSERS = new Set(["done", "fi"]);

/** Words that start shell syntax handoff does not read: a case, a brace group, a function or a select. */
const UNREADABLE = new Set(["case", "esac", "{", "}", "function", "select", "coproc"]);

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/**
 * The command one simple command runs, as its words without the keywords and variable assignments in
 * front: an empty list when it runs none (a bare done or fi, or a `for NAME in WORDS` header), and
 * undefined when it is shell syntax handoff does not read.
 */
function commandWords(simple: string[]): string[] | undefined {
  let words = simple;
  while (words[0] !== undefined && (KEYWORDS.has(words[0]) || isAssignment(words[0]))) words = words.slice(1);
  const [first] = words;
  if (first === undefined) return [];
  if (CLOSERS.has(first)) return words.length === 1 ? [] : undefined;
  if (first === "for") return /^[A-Za-z_][A-Za-z0-9_]*$/.test(words[1] ?? "") && words[2] === "in" ? [] : undefined;
  if (UNREADABLE.has(first)) return undefined;
  return words;
}

/** A simple command's words, without the keywords and variable assignments in front of its program. */
function wordsOf(command: string): string[] | undefined {
  return commandWords(command.trim().split(/\s+/).filter(Boolean));
}

/** The rule for one simple command: its program, or its program and subcommand, with any arguments. */
function commandRule(words: string[]): string | undefined {
  const [program, subcommand] = words;
  if (!program || NEVER.has(program) || /[(){}]/.test(program)) return undefined;
  if (!WITH_SUBCOMMANDS.has(program)) return `Bash(${program} *)`;
  // An option before the subcommand (git -C dir log) leaves no rule short of every command of the program.
  if (!subcommand || !/^[A-Za-z][\w:.-]*$/.test(subcommand)) return undefined;
  return `Bash(${program} ${subcommand} *)`;
}

/**
 * The allow rule that would cover this call from now on: a command's program with any arguments (its
 * subcommand too, for programs such as git and pnpm), or the tool itself. It goes into the node's allow
 * list in the graph's next version, and the run's own list. Undefined when no rule is safe to offer: for
 * cd, node, a shell or env, which would allow anything, an option before a subcommand, or shell syntax
 * handoff does not read (case, a subshell, braces). In a compound command a leading cd needs no rule,
 * and the rule is for the first command after it. A loop or a check gets no rule for its keyword: the
 * rule is for the first command a `for` loop's body runs, or for the command a while, until or if checks.
 */
export function ruleFor(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== "Bash" || typeof input.command !== "string") return toolName;
  const parts: (string[] | undefined)[] = input.command
    .split(SEPARATORS)
    .map(wordsOf)
    .filter((words) => words === undefined || words.length > 0);
  const first = parts.find((words) => words === undefined || words[0] !== "cd") ?? parts[0];
  return first ? commandRule(first) : undefined;
}

/** Whether a Bash rule, such as `Bash(git log *)` or `Bash(pnpm test)`, covers one simple command's words. */
function bashRuleCovers(rule: string, words: string[]): boolean {
  const pattern = /^Bash\((.+)\)$/.exec(rule)?.[1];
  if (!pattern || pattern === "*") return pattern === "*";
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
  const command = words.join(" ");
  if (!pattern.endsWith(" *")) return command === pattern;
  const prefix = pattern.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
}

/** A redirect target with no file behind it: /dev/null, or a file descriptor after >& or <& (2>&1, <&3, >&-). */
const noFile = (operator: string, target: string) => target === "/dev/null" || (/[<>]&$/.test(operator) && /^(\d+|-)$/.test(target));

/**
 * A command's simple commands, each as its words, the way Claude Code splits a compound command: on
 * &&, ||, ;, |, |&, & and newlines, never inside single or double quotes or after a backslash. A
 * redirect to /dev/null or to a file descriptor (2>&1, >&2, <&3) is left out of the words. Undefined
 * when the command cannot be read: unbalanced quotes, an operator with nothing after it, a here-doc or
 * process substitution, a parenthesis outside quotes, or a redirect to a file, which a Bash rule does
 * not cover.
 */
function simpleCommands(command: string): string[][] | undefined {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  // Whether the word under way has any text, also an empty quoted one, and whether all of it is unquoted digits (a file descriptor).
  let started = false;
  let digits = true;
  let operatorPending = false;
  let i = 0;
  const endWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
    digits = true;
  };
  const endCommand = (separator: string): boolean => {
    endWord();
    if (words.length > 0) {
      commands.push(words);
      words = [];
      operatorPending = separator !== "\n";
      return true;
    }
    // A newline after an operator, or a blank line, is fine; an operator after nothing is not.
    if (separator === "\n") return true;
    return false;
  };
  /** Reads one word at i, quotes and escapes included, for a redirect's target. */
  const readTarget = (): string | undefined => {
    while (command[i] === " " || command[i] === "\t") i++;
    const start = i;
    while (i < command.length && !/[\s;&|<>()]/.test(command[i]!)) {
      const c = command[i]!;
      if (c === "\\") {
        if (i + 1 >= command.length) return undefined;
        i += 2;
      } else if (c === "'" || c === '"') {
        const end = closing(c, i);
        if (end === undefined) return undefined;
        i = end + 1;
      } else i++;
    }
    return i > start ? command.slice(start, i) : undefined;
  };
  /** The index of the quote that closes the one at start, or undefined when it is never closed. */
  const closing = (quote: string, start: number): number | undefined => {
    for (let j = start + 1; j < command.length; j++) {
      if (quote === '"' && command[j] === "\\") j++;
      else if (command[j] === quote) return j;
    }
    return undefined;
  };
  while (i < command.length) {
    const c = command[i]!;
    const two = command.slice(i, i + 2);
    if (c === " " || c === "\t") {
      endWord();
      i++;
    } else if (c === "\\") {
      if (i + 1 >= command.length) return undefined;
      // A backslash before a newline joins the lines.
      if (command[i + 1] !== "\n") {
        word += two;
        started = true;
        digits = false;
      }
      i += 2;
    } else if (c === "'" || c === '"') {
      const end = closing(c, i);
      if (end === undefined) return undefined;
      word += command.slice(i, end + 1);
      started = true;
      digits = false;
      i = end + 1;
    } else if (c === ">" || c === "<" || two === "&>") {
      // A word of digits right before > or < is the file descriptor it redirects.
      if (!(started && digits)) endWord();
      word = "";
      started = false;
      digits = true;
      const operator = /^(&>>|&>|>>|>&|>\||<&|<<|<>|>|<)/.exec(command.slice(i))![1]!;
      if (operator === "<<" || command[i + operator.length] === "(") return undefined;
      i += operator.length;
      const target = readTarget();
      if (target === undefined || !noFile(operator, target)) return undefined;
    } else if (two === "&&" || two === "||" || two === "|&") {
      if (!endCommand(two)) return undefined;
      i += 2;
    } else if (c === ";" || c === "|" || c === "&" || c === "\n") {
      if (!endCommand(c)) return undefined;
      i++;
    } else if (c === "(" || c === ")") {
      // A subshell, a function, a case pattern or arithmetic: shell syntax this does not read.
      return undefined;
    } else {
      word += c;
      started = true;
      if (!/\d/.test(c)) digits = false;
      i++;
    }
  }
  endWord();
  if (words.length > 0) {
    commands.push(words);
    operatorPending = false;
  }
  return operatorPending || commands.length === 0 ? undefined : commands;
}

/**
 * The rule among a run's Always allow rules that covers this call, read the way Claude Code reads its
 * allow rules, or undefined. A rule without parentheses covers every call of its tool. A Bash rule covers
 * a command when it covers each simple command in it, a cd in front aside, without redirects to /dev/null
 * or a file descriptor; Monitor's commands follow the Bash rules. In a loop or a check each command it
 * runs is matched, the header of a while, until, if or elif too, and a `for NAME in WORDS` header needs
 * no rule. A command with a command inside it ($() or backticks), a redirect to a file, a case, a
 * subshell, braces, a function, or one that cannot be read is never covered: a person looks at it.
 */
export function allowedBy(rules: string[], toolName: string, input: Record<string, unknown>): string | undefined {
  const whole = rules.find((rule) => rule === toolName || rule === `${toolName}(*)`);
  if (whole) return whole;
  if ((toolName !== "Bash" && toolName !== "Monitor") || typeof input.command !== "string") return undefined;
  const command = input.command.trim();
  if (/\$\(|`/.test(command)) return undefined;
  const commands = simpleCommands(command)?.map(commandWords);
  if (!commands || commands.some((words) => words === undefined)) return undefined;
  const run = (commands as string[][]).filter((words) => words.length > 0 && words[0] !== "cd");
  if (run.length === 0) return undefined;
  const covering = run.map((words) => rules.find((rule) => bashRuleCovers(rule, words)));
  return covering.every(Boolean) ? covering[0] : undefined;
}
