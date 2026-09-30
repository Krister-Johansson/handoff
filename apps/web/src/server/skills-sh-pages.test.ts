import { expect, test } from "vitest";
import { parseOwnerPage, parseRepoPage, parseSkillPage } from "./skills-sh-pages";

// Shaped like skills.sh's server-rendered pages: navigation, then the listing as links and text.
const nav = `<nav><a href="/">Skills</a><a href="/packs">Packs</a><a href="/audits">Audits</a></nav>`;

const ownerHtml = `<html><head><title>x</title></head><body>${nav}
<main><h1>mattpocock</h1><div>9</div><div>sources</div><div>76</div><div>skills</div>
<a href="/mattpocock/skills"><span>skills</span><span>54</span><span>skills</span><span>:</span><span>grill-me, tdd</span><span>25.4M</span></a>
<a href="/mattpocock/sandcastle"><span>sandcastle</span><span>1</span><span>skill</span><span>:</span><span>pre-release</span><span>34</span></a>
<script>self.__next_f.push([1,"/mattpocock/ignored-in-script"])</script></main></body></html>`;

const repoHtml = `<html><body>${nav}
<main><h1>mattpocock/skills</h1><div>54</div><div>skills</div><div>25.4M</div><div>total installs</div>
<div>Skill</div><div>Installs</div>
<a href="/mattpocock/skills/grill-me"><span>grill-me</span><span>1.3M</span></a>
<a href="/mattpocock/skills/tdd"><span>tdd</span><span>990.8K</span></a>
<a href="/mattpocock/skills/wizard"><span>wizard</span><span>12</span></a>
</main></body></html>`;

test("an owner page lists the owner's repositories with their skill counts", () => {
  expect(parseOwnerPage(ownerHtml, "mattpocock")).toEqual([
    { repo: "mattpocock/skills", skills: 54 },
    { repo: "mattpocock/sandcastle", skills: 1 },
  ]);
});

test("a repository page lists its skills with their installs", () => {
  expect(parseRepoPage(repoHtml, "mattpocock/skills")).toEqual([
    { id: "mattpocock/skills/grill-me", skillId: "grill-me", installs: 1_300_000 },
    { id: "mattpocock/skills/tdd", skillId: "tdd", installs: 990_800 },
    { id: "mattpocock/skills/wizard", skillId: "wizard", installs: 12 },
  ]);
});

test("a page without the expected listing is an error, not an empty list", () => {
  expect(() => parseRepoPage(`<html><body>${nav}<main>Not found</main></body></html>`, "a/b")).toThrow(/no skills/);
  expect(() => parseOwnerPage(`<html><body>${nav}</body></html>`, "nobody")).toThrow(/no repositories/);
});

const skillHtml = `<html><body>${nav}<main>
<h1>tdd</h1><div>Installation</div><code>npx skills add https://github.com/mattpocock/skills --skill tdd</code>
<h2>Summary</h2>
<p>Test-driven development with vertical slices.</p>
<ul><li>Tests verify behavior through public APIs</li><li>One test, one implementation, repeat</li></ul>
<h2>SKILL.md</h2><article><h1>Test-Driven Development</h1><p>Body of the skill.</p></article>
<aside><div>Installs</div><div>990.5K</div><div>Repository</div><div>mattpocock/skills</div><div>GitHub Stars</div><div>272.0K</div>
<div>First Seen</div><div>Feb 10, 2026</div><div>Security Audits</div>
<a href="/mattpocock/skills/tdd/security/agent-trust-hub"><span>Gen Agent Trust Hub</span><span>Pass</span></a>
<a href="/mattpocock/skills/tdd/security/socket"><span>Socket</span><span>Pass</span></a>
<a href="/mattpocock/skills/tdd/security/snyk"><span>Snyk</span><span>Warn</span></a></aside>
<div>Browse</div><div>All skills</div></main></body></html>`;

test("a skill page gives the summary, installs, repository, stars, first seen and security audits", () => {
  expect(parseSkillPage(skillHtml)).toEqual({
    summary: "Test-driven development with vertical slices.",
    points: ["Tests verify behavior through public APIs", "One test, one implementation, repeat"],
    installs: 990_500,
    repository: "mattpocock/skills",
    githubStars: 272_000,
    firstSeen: "Feb 10, 2026",
    audits: [
      { name: "Gen Agent Trust Hub", result: "Pass" },
      { name: "Socket", result: "Pass" },
      { name: "Snyk", result: "Warn" },
    ],
  });
});

test("a skill page without those sections gives what it has", () => {
  expect(parseSkillPage(`<html><body>${nav}<main><div>Installs</div><div>12</div></main></body></html>`)).toEqual({ installs: 12, points: [], audits: [] });
});
