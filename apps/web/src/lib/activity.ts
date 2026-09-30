type EventLike = { seq: number; type: string; payload: unknown };

export type ActivityItem =
  | { kind: "message"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; id: string; name: string; target?: string; result?: string; error?: boolean };

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

/** What a tool call is about, in one line: the file, the command, the search or the question. */
const targetOf = (input: Record<string, unknown>) => {
  for (const key of ["file_path", "path", "command", "pattern", "query", "url", "skill", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0]!;
  }
  return undefined;
};

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
      }
    }
  }
  return { items, stats };
}
