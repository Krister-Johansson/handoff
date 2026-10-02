/** Programs whose second word is a subcommand that decides what they do, so a rule names both. */
const WITH_SUBCOMMANDS = new Set(["git", "pnpm", "npm", "npx", "yarn", "bun", "gh", "docker", "cargo", "go", "uv", "pip", "kubectl"]);

/** Programs that run whatever follows them: a rule for one would allow any command. */
const NEVER = new Set(["cd", "node", "sh", "bash", "zsh", "env", "eval", "exec", "sudo", "xargs", "python", "python3"]);

/** Claude Code's command separators: it matches each part of a compound command against the rules on its own. */
const SEPARATORS = /&&|\|\||\|&|[;|&\n]/;

/** The rule for one simple command: its program, or its program and subcommand, with any arguments. */
function commandRule(command: string): string | undefined {
  // Variable assignments in front of the program are not part of it.
  const words = command.trim().split(/\s+/).filter(Boolean);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const [program, subcommand] = words;
  if (!program || NEVER.has(program)) return undefined;
  if (!WITH_SUBCOMMANDS.has(program)) return `Bash(${program} *)`;
  // An option before the subcommand (git -C dir log) leaves no rule short of every command of the program.
  if (!subcommand || !/^[A-Za-z][\w:.-]*$/.test(subcommand)) return undefined;
  return `Bash(${program} ${subcommand} *)`;
}

/**
 * The allow rule that would cover this call from now on: a command's program with any arguments (its
 * subcommand too, for programs such as git and pnpm), or the tool itself. It goes into the node's allow
 * list in the graph's next version. Undefined when no rule is safe to offer: for cd, node, a shell or
 * env, which would allow anything, or an option before a subcommand. In a compound command a leading cd
 * needs no rule, and the rule is for the first command after it.
 */
export function ruleFor(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== "Bash" || typeof input.command !== "string") return toolName;
  const parts = input.command.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const first = parts.find((p) => !/^cd(\s|$)/.test(p)) ?? parts[0];
  return first ? commandRule(first) : undefined;
}
