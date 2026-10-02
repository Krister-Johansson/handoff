import { expect, test } from "vitest";
import { allowPathsOf } from "./allow-paths";

test("files to allow are read from a list separated by commas or new lines, without blanks or repeats", () => {
  expect(allowPathsOf(" pnpm-lock.yaml, docs/setup.md\nnotes.txt,,pnpm-lock.yaml \n")).toEqual(["pnpm-lock.yaml", "docs/setup.md", "notes.txt"]);
  expect(allowPathsOf("")).toEqual([]);
});
