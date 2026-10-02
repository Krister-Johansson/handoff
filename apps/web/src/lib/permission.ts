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
