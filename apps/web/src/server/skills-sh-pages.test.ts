import { expect, test } from "vitest";
import { parseOwnerPage, parseRepoPage } from "./skills-sh-pages";

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
