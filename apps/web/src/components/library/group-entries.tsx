const SHOWN = 3;

/** A group's entries as small chips naming kind and entry: the first three, then how many more. */
export function GroupEntries({ skills, mcp, agents }: { skills: string[]; mcp: string[]; agents: string[] }) {
  const entries = [...skills.map((name) => ({ kind: "skill", name })), ...mcp.map((name) => ({ kind: "MCP", name })), ...agents.map((name) => ({ kind: "agent", name }))];
  const rest = entries.slice(SHOWN);
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {entries.slice(0, SHOWN).map((e) => (
        <li key={`${e.kind}:${e.name}`} className="inline-flex h-[22px] items-center gap-1 rounded-[5px] bg-secondary px-2 text-[11px]">
          <span className="text-muted-foreground">{e.kind}</span>
          <span className="font-mono text-foreground">{e.name}</span>
        </li>
      ))}
      {rest.length > 0 && (
        <li className="inline-flex h-[22px] items-center rounded-[5px] bg-secondary px-2 font-mono text-[11px]" title={rest.map((e) => e.name).join(", ")}>
          +{rest.length}
        </li>
      )}
    </ul>
  );
}
