/** What a permission request asks, in words: the action for a title and the detail a person checks. */
export function describePermission(toolName: string, input: Record<string, unknown>): { action: string; detail: string } {
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  if (toolName === "Bash") return { action: "asks to run a command", detail: text("command") ?? "" };
  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") return { action: "asks to change a file", detail: text("file_path") ?? text("notebook_path") ?? "" };
  if (toolName === "WebFetch") return { action: "asks to fetch a page", detail: text("url") ?? "" };
  if (toolName === "WebSearch") return { action: "asks to search the web", detail: text("query") ?? "" };
  return { action: `asks to use ${toolName}`, detail: JSON.stringify(input) };
}

/**
 * The allow rule that would cover this call from now on: a command's program with any arguments, or
 * the tool itself. It goes into the node's allow list in the graph's next version.
 */
export function ruleFor(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    const program = input.command.trim().split(/\s+/)[0];
    if (program) return `Bash(${program} *)`;
  }
  return toolName;
}
