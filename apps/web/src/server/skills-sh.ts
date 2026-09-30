type Fetch = typeof globalThis.fetch;

export type SkillsShResult = { id: string; source: string; skillId: string; name: string; installs: number };
export type SkillsShDownload = { files: { path: string; content: string }[]; hash: string };

const SKILL_ID = /^[\w.-]+\/[\w.-]+\/[\w.-]+$/;
const isSkillId = (id: string) => SKILL_ID.test(id) && id.split("/").every((part) => part !== "." && part !== "..");

/**
 * skills.sh, the directory behind `npx skills`. Uses the endpoints the skills CLI uses (search and
 * download); they are not a documented API, so callers show failures instead of assuming them away.
 */
export class SkillsShClient {
  private readonly fetch: Fetch;
  private readonly base: string;

  constructor(opts: { fetch?: Fetch; base?: string } = {}) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.base = opts.base ?? "https://skills.sh";
  }

  async search(query: string, limit = 30): Promise<SkillsShResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const data = await this.get<{ skills?: SkillsShResult[] }>(`${this.base}/api/search?${params}`);
    return [...(data.skills ?? [])].sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));
  }

  /** All files of a skill (SKILL.md and supporting files) and skills.sh's hash of them. */
  async download(id: string): Promise<SkillsShDownload> {
    if (!isSkillId(id)) throw new Error(`${id} is not a skills.sh id (owner/repo/skill)`);
    const path = id.split("/").map(encodeURIComponent).join("/");
    const data = await this.get<{ files?: { path: string; contents: string }[]; hash?: string }>(`${this.base}/api/download/${path}`);
    return { files: (data.files ?? []).map((f) => ({ path: f.path, content: f.contents })), hash: data.hash ?? "" };
  }

  private async get<T>(url: string): Promise<T> {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`skills.sh answered ${response.status} for ${new URL(url).pathname}`);
    return (await response.json()) as T;
  }
}
