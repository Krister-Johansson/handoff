/**
 * The issue numbers an issue body says it depends on, from its "Depends on" line, as in
 * `Depends on: #5 (F05), #6 (F06)`. Numbers elsewhere in the body do not count.
 */
export function parseDependsOn(body: string): number[] {
  const line = body.split("\n").find((l) => /^\W*depends on\b/i.test(l.trim()));
  if (!line) return [];
  return [...new Set([...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];
}
