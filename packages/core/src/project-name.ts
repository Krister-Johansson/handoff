/** A project name from a repository name: lowercase letters, digits and dashes, not already taken. */
export function suggestProjectName(repoName: string, taken: string[]): string {
  const base =
    repoName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const used = new Set(taken);
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
  return name;
}
