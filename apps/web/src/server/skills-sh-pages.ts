/**
 * Parsers for skills.sh's owner and repository pages. skills.sh has no API for these listings, so this
 * reads the server-rendered HTML: every row is a link to the entry that wraps its name and numbers.
 * When the expected rows are missing the parsers throw, so a changed page shows up as an error.
 */

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");

/** Visible text pieces of an HTML fragment, in order. */
const pieces = (fragment: string) =>
  fragment
    .replace(/<!--.*?-->/gs, "")
    .split(/<[^>]+>/)
    .map((t) => decode(t).trim())
    .filter(Boolean);

/** Links in the page's markup (not in scripts), with their visible text. */
function links(html: string): { href: string; text: string[] }[] {
  const markup = html.replace(/<script\b.*?<\/script>/gs, "");
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ href: m[1]!, text: pieces(m[2]!) }));
}

/** "990.8K" → 990800, "1.3M" → 1300000, "12" → 12. */
export function parseCount(text: string): number | undefined {
  const match = /^([\d.,]+)\s*([KMB])?$/i.exec(text.trim());
  if (!match) return undefined;
  const n = Number(match[1]!.replace(/,/g, ""));
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * scale);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The owner's repositories on skills.sh, with how many skills each has. */
export function parseOwnerPage(html: string, owner: string): { repo: string; skills: number }[] {
  const row = new RegExp(`^/${escape(owner)}/([\\w.-]+)$`);
  const seen = new Set<string>();
  const repos: { repo: string; skills: number }[] = [];
  for (const link of links(html)) {
    const match = row.exec(link.href);
    if (!match || seen.has(match[1]!)) continue;
    seen.add(match[1]!);
    const count = /(\d+)\s*skills?\b/.exec(link.text.join(" "));
    repos.push({ repo: `${owner}/${match[1]}`, skills: count ? Number(count[1]) : 0 });
  }
  if (repos.length === 0) throw new Error(`skills.sh lists no repositories for ${owner}`);
  return repos;
}

/** A repository's skills on skills.sh, with their install counts, most installed first as listed. */
export function parseRepoPage(html: string, repo: string): { id: string; skillId: string; installs: number }[] {
  const row = new RegExp(`^/${escape(repo)}/([\\w.-]+)$`);
  const seen = new Set<string>();
  const skills: { id: string; skillId: string; installs: number }[] = [];
  for (const link of links(html)) {
    const match = row.exec(link.href);
    if (!match || seen.has(match[1]!)) continue;
    seen.add(match[1]!);
    const installs = [...link.text].reverse().map(parseCount).find((n) => n !== undefined) ?? 0;
    skills.push({ id: `${repo}/${match[1]}`, skillId: match[1]!, installs });
  }
  if (skills.length === 0) throw new Error(`skills.sh lists no skills for ${repo}`);
  return skills;
}
