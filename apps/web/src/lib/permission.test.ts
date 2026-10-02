import { expect, test } from "vitest";
import { ruleFor } from "./permission";

const bash = (command: string) => ruleFor("Bash", { command });

test("Always allow offers git show, not git, and nothing for cd or node", () => {
  expect(bash("git show HEAD~1:src/a.ts")).toBe("Bash(git show *)");
  expect(bash("pnpm list --depth 0")).toBe("Bash(pnpm list *)");
  expect(bash("cat package.json")).toBe("Bash(cat *)");
  // An option before the subcommand would need a rule for every git command.
  expect(bash("git -C packages/core log")).toBeUndefined();
  for (const command of ["cd apps/web", "node -e 'console.log(1)'", "sh -c 'ls'", "bash scripts/x.sh", "env FOO=1 pnpm test"]) expect(bash(command)).toBeUndefined();
  // Claude Code matches each part of a compound command on its own; a cd in front needs no rule.
  expect(bash("cd apps/web && pnpm list react")).toBe("Bash(pnpm list *)");
  expect(bash("FORCE_COLOR=0 git diff main")).toBe("Bash(git diff *)");
  expect(ruleFor("WebFetch", { url: "https://example.com" })).toBe("WebFetch");
});
