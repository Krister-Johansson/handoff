import { expect, test } from "vitest";
import { matchesLibrarySearch } from "./library-search";

test("a library search finds entries whose fields hold every word, ignoring case; an empty search matches everything", () => {
  const skill = ["ci-triage", "Read a failed GitHub Actions job log"];
  expect(matchesLibrarySearch(skill, "")).toBe(true);
  expect(matchesLibrarySearch(skill, "  ")).toBe(true);
  expect(matchesLibrarySearch(skill, "TRIAGE")).toBe(true);
  expect(matchesLibrarySearch(skill, "github actions")).toBe(true);
  expect(matchesLibrarySearch(skill, "postgres")).toBe(false);
  expect(matchesLibrarySearch(skill, undefined)).toBe(true);
});
