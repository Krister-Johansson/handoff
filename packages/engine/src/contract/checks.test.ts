import { expect, test } from "vitest";
import { outsideOwned } from "./checks.ts";

test("owning package.json owns its lockfile and pnpm-workspace.yaml", () => {
  const changed = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "src/app.ts"];
  expect(outsideOwned(changed, ["package.json", "src/app.ts"])).toEqual([]);
  // In a workspace the lockfile sits at the root, next to pnpm-workspace.yaml, whichever package.json changed.
  expect(outsideOwned(["apps/web/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], ["apps/web"])).toEqual([]);
  expect(outsideOwned(["apps/web/package.json", "apps/web/package-lock.json"], ["apps/web/package.json"])).toEqual([]);
  for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"]) {
    expect(outsideOwned(["package.json", lockfile], ["package.json"])).toEqual([]);
  }
  // Without an owned package.json, the lockfile is outside the plan like any other file.
  expect(outsideOwned(["pnpm-lock.yaml", "pnpm-workspace.yaml", "src/app.ts"], ["src"])).toEqual(["pnpm-lock.yaml", "pnpm-workspace.yaml"]);
  expect(outsideOwned(["apps/api/package-lock.json"], ["apps/web/package.json"])).toEqual(["apps/api/package-lock.json"]);
});
