import { expect, test } from "vitest";
import { overlaps } from "./overlap.ts";

test("a directory owns the files under it, a file owns itself, and package.json owns its lockfile", () => {
  // A directory and a file under it share that file; a file shares itself.
  expect(overlaps(["apps/board"], ["apps/board/card.tsx", "apps/api/route.ts"])).toEqual(["apps/board/card.tsx"]);
  expect(overlaps(["apps/board/card.tsx"], ["apps/board/"])).toEqual(["apps/board/card.tsx"]);
  expect(overlaps(["README.md"], ["README.md"])).toEqual(["README.md"]);
  // A directory does not own a sibling whose name starts the same way.
  expect(overlaps(["apps/board"], ["apps/boarding", "apps/board.ts"])).toEqual([]);
  // A glob owns what its fixed directory holds.
  expect(overlaps(["apps/board/**/*.tsx"], ["apps/board/card.tsx"])).toEqual(["apps/board/card.tsx"]);
  expect(overlaps(["apps/board/**/*.tsx"], ["apps/api/**"])).toEqual([]);
  // package.json owns the lockfile next to it, and in a workspace the lockfile and workspace file at the root.
  expect(overlaps(["package.json"], ["pnpm-lock.yaml"])).toEqual(["pnpm-lock.yaml"]);
  expect(overlaps(["apps/web/package.json"], ["apps/web/yarn.lock"])).toEqual(["apps/web/yarn.lock"]);
  expect(overlaps(["pnpm-workspace.yaml"], ["packages/db/package.json"])).toEqual(["pnpm-workspace.yaml"]);
  // Two package.json files share the root lockfile, so both are named.
  expect(overlaps(["apps/web/package.json"], ["packages/db/package.json"])).toEqual(["apps/web/package.json", "packages/db/package.json"]);
  // A lockfile elsewhere is not owned by an unrelated directory.
  expect(overlaps(["apps/web/src"], ["pnpm-lock.yaml", "packages/db/package-lock.json"])).toEqual([]);
  // Nothing shared without paths on either side.
  expect(overlaps([], ["apps/board"])).toEqual([]);
});
