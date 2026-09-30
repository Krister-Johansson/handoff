import { expect, test } from "vitest";
import { SkillsShClient } from "./skills-sh";

const fakeFetch = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? new Response(JSON.stringify(routes[key])) : new Response("not found", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
};

test("search returns skills by install count, highest first", async () => {
  const { fetch, calls } = fakeFetch({
    "https://skills.sh/api/search": {
      skills: [
        { id: "a/b/tdd-lite", source: "a/b", skillId: "tdd-lite", name: "tdd-lite", installs: 10 },
        { id: "mattpocock/skills/tdd", source: "mattpocock/skills", skillId: "tdd", name: "tdd", installs: 988340 },
      ],
    },
  });
  const client = new SkillsShClient({ fetch });
  expect((await client.search("tdd")).map((s) => s.id)).toEqual(["mattpocock/skills/tdd", "a/b/tdd-lite"]);
  expect(new URL(calls[0]!).searchParams.get("q")).toBe("tdd");
});

test("download returns a skill's files and content hash", async () => {
  const { fetch, calls } = fakeFetch({
    "https://skills.sh/api/download/mattpocock/skills/tdd": { files: [{ path: "SKILL.md", contents: "---\nname: tdd\n---\nBody" }], hash: "h1" },
  });
  const client = new SkillsShClient({ fetch });
  expect(await client.download("mattpocock/skills/tdd")).toEqual({ files: [{ path: "SKILL.md", content: "---\nname: tdd\n---\nBody" }], hash: "h1" });
  expect(calls[0]).toBe("https://skills.sh/api/download/mattpocock/skills/tdd");
});

test("an id that is not owner/repo/skill is refused before any request", async () => {
  const { fetch, calls } = fakeFetch({});
  await expect(new SkillsShClient({ fetch }).download("../etc/passwd")).rejects.toThrow(/owner\/repo\/skill/);
  expect(calls).toEqual([]);
});

test("a failed request says what failed", async () => {
  const { fetch } = fakeFetch({});
  await expect(new SkillsShClient({ fetch }).download("a/b/c")).rejects.toThrow(/skills.sh.*404/);
});
