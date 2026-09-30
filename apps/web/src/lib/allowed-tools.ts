/** The tools ticked in a picker: every tool when nothing is restricted. */
export function tickedTools(all: string[], allowed: string[]): Set<string> {
  return new Set(allowed.length ? allowed : all);
}

/** What to store as a server's allowed tools: empty when every tool is ticked, which allows every tool. */
export function allowedFromTicked(all: string[], ticked: Set<string>): string[] {
  return all.every((name) => ticked.has(name)) ? [] : all.filter((name) => ticked.has(name));
}
