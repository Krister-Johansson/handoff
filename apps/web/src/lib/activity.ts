type EventLike = { seq: number; type: string; payload: unknown };

export type ActivityItem =
  | { kind: "message"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; id: string; name: string; target?: string; result?: string; error?: boolean; denied?: Denial };

/** A tool call the CLI refused because it needed an approval nobody can give in a run, and the rules that would allow it. */
export type Denial = { reason: string; rules: string[] };

export type ActivityStats = { model?: string; tools: number; thinkingTokens?: number; turns?: number; costUsd?: number };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const content = (payload: unknown) => {
  const c = obj(obj(payload).message).content;
  return Array.isArray(c) ? c.map(obj) : [];
};

/** An MCP tool reads as "server · tool"; built-in tools keep their name. */
const toolName = (name: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : name;
};

/** A run's worktree, which agents name by its absolute path: `<home>/.handoff/worktrees/<run id>`. */
const WORKTREE = /\S*\/\.handoff\/worktrees\/[0-9a-f-]{36}(\/)?/g;
const relative = (text: string) => text.replace(WORKTREE, (_, slash: string | undefined) => (slash ? "" : "."));

/** What a tool call is about, in one line: the file, the command, the search or the question. */
const targetOf = (input: Record<string, unknown>) => {
  for (const key of ["file_path", "command", "pattern", "query", "url", "skill", "path", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return relative(value.trim().split("\n")[0]!);
  }
  return undefined;
};

const REQUIRED = /What required approval:\s*([\s\S]*)$/;
const PARTS = /The following parts? requires? approval:\s*([\s\S]*)$/;

/** `Bash(git log *)` for a command part: its first two words, or its one word. */
const bashRule = (part: string) => {
  const words = part.replace(/\s+\d?>&?\d?\S*/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length ? `Bash(${words.slice(0, 2).join(" ")} *)` : undefined;
};

/** What the CLI refused and which permission rules would allow it; undefined for any other result. */
function denialOf(toolName: string, text: string): Denial | undefined {
  const required = REQUIRED.exec(text)?.[1]?.trim();
  if (!required) return undefined;
  const parts = PARTS.exec(required)?.[1];
  if (toolName !== "Bash") return { reason: required, rules: [toolName.includes(" · ") ? `mcp__${toolName.replace(" · ", "__")}` : toolName] };
  if (!parts) return { reason: required, rules: [] };
  const rules = parts
    .split(/\s*(?:&&|\|\||;|\||,\s)\s*/)
    .map(bashRule)
    .filter((r): r is string => r !== undefined);
  return { reason: required, rules: [...new Set(rules)] };
}

const resultText = (c: unknown) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .map(obj)
          .map((b) => (typeof b.text === "string" ? b.text : ""))
          .join("\n")
      : "";

/**
 * A node's Claude CLI events as a timeline a person can follow: what the agent said, what it thought
 * (when the summaries are there), and each tool call with its result, plus totals for the header.
 */
export function toActivity(events: EventLike[]): { items: ActivityItem[]; stats: ActivityStats } {
  const items: ActivityItem[] = [];
  const tools = new Map<string, Extract<ActivityItem, { kind: "tool" }>>();
  const stats: ActivityStats = { tools: 0 };
  for (const event of events) {
    const p = obj(event.payload);
    if (event.type === "cli.system.init" && typeof p.model === "string") stats.model = p.model;
    else if (event.type === "cli.system.thinking_tokens" && typeof p.estimated_tokens === "number") stats.thinkingTokens = p.estimated_tokens;
    else if (event.type.startsWith("cli.result")) {
      if (typeof p.num_turns === "number") stats.turns = p.num_turns;
      if (typeof p.total_cost_usd === "number") stats.costUsd = p.total_cost_usd;
    } else if (event.type === "cli.assistant") {
      content(p).forEach((block, i) => {
        const key = `${event.seq}:${i}`;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) items.push({ kind: "message", key, text: block.text.trim() });
        else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) items.push({ kind: "thinking", key, text: block.thinking.trim() });
        else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          const target = targetOf(obj(block.input));
          const tool: Extract<ActivityItem, { kind: "tool" }> = { kind: "tool", key, id: block.id, name: toolName(block.name), ...(target ? { target } : {}) };
          tools.set(block.id, tool);
          items.push(tool);
          stats.tools++;
        }
      });
    } else if (event.type === "cli.user") {
      for (const block of content(p)) {
        const tool = typeof block.tool_use_id === "string" ? tools.get(block.tool_use_id) : undefined;
        if (block.type !== "tool_result" || !tool) continue;
        tool.result = resultText(block.content);
        tool.error = block.is_error === true;
        const denied = tool.error ? denialOf(tool.name, tool.result) : undefined;
        if (denied) tool.denied = denied;
      }
    }
  }
  return { items, stats };
}

type ToolItem = Extract<ActivityItem, { kind: "tool" }>;

export type ChatEntry =
  | { kind: "message"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tools"; key: string; summary: string; tools: ToolItem[]; running: boolean; errors: number; denied: number };

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** What a group of calls to one tool did, in a few words: "read 3 files", "ran a command", "used context7 twice". */
function phrase(name: string, n: number): string {
  if (name === "Read") return `read ${count(n, "a file", "files")}`;
  if (name === "Bash") return `ran ${count(n, "a command", "commands")}`;
  if (name === "Grep" || name === "Glob") return `searched ${times(n)}`;
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(name)) return `edited ${count(n, "a file", "files")}`;
  if (name === "WebFetch" || name === "WebSearch") return `used the web ${times(n)}`;
  if (name === "Skill") return `used ${count(n, "a skill", "skills")}`;
  if (name === "Agent" || name === "Task") return `ran ${count(n, "a subagent", "subagents")}`;
  const server = name.split(" · ")[0]!;
  return `used ${server} ${times(n)}`;
}

/** The kind of work a tool does, so calls to the same kind are counted together. */
const kindOf = (name: string) => (name === "Glob" ? "Grep" : ["MultiEdit", "Write", "NotebookEdit"].includes(name) ? "Edit" : name === "WebSearch" ? "WebFetch" : name.split(" · ")[0]!);

/** Tools the CLI uses for itself, which say nothing about the work: loading tool schemas, returning the output. */
const PLUMBING = new Set(["ToolSearch", "StructuredOutput"]);

/** "Read 2 files, ran a command": what a run of consecutive tool calls did, in the order it did it. */
function summarize(tools: ToolItem[]): string {
  const counts = new Map<string, { name: string; n: number }>();
  const work = tools.filter((t) => !PLUMBING.has(t.name));
  if (work.length === 0) return "Prepared its answer";
  for (const tool of work) {
    const kind = kindOf(tool.name);
    const seen = counts.get(kind);
    counts.set(kind, { name: seen?.name ?? tool.name, n: (seen?.n ?? 0) + 1 });
  }
  const text = [...counts.values()].map(({ name, n }) => phrase(name, n)).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The timeline as a conversation, the way Claude Code shows it: the agent's messages and thinking in
 * turn, with each run of consecutive tool calls folded into one step that says what they did.
 */
export function toChat(items: ActivityItem[]): ChatEntry[] {
  const chat: ChatEntry[] = [];
  let group: ToolItem[] | undefined;
  const close = () => {
    if (!group) return;
    chat.push({
      kind: "tools",
      key: group[0]!.key,
      summary: summarize(group),
      tools: group,
      running: group.some((t) => t.result === undefined),
      errors: group.filter((t) => t.error && !t.denied).length,
      denied: group.filter((t) => t.denied).length,
    });
    group = undefined;
  };
  for (const item of items) {
    if (item.kind === "tool") (group ??= []).push(item);
    else {
      close();
      chat.push(item);
    }
  }
  close();
  return chat;
}
