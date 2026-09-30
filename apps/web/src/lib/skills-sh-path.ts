/** "mattpocock", "mattpocock/skills" or a skills.sh URL → that owner's or repository's page in the library. */
export function skillsShPath(input: string): string | null {
  const path = input
    .trim()
    .replace(/^https?:\/\/(www\.)?skills\.sh\/?/, "")
    .replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 2 || !parts.every((p) => /^[\w.-]+$/.test(p) && p !== "." && p !== "..")) return null;
  return `/library/skills-sh/${parts.join("/")}`;
}
