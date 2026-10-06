import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");

test("the local webhook forwarder relays every event the README asks the GitHub App for", () => {
  const forwarded = root("scripts/forward-webhooks.sh").match(/--events=([\w,]+)/)![1]!.split(",");
  const setup = root("README.md").split("\n").find((line) => line.includes("The App needs read and write access"))!;
  const asked = [...setup.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!).filter((name) => /^(pull_request|issue|check_|workflow_|sub_issues)/.test(name));
  expect(asked).toContain("pull_request_review_thread");
  expect(forwarded).toEqual(expect.arrayContaining(asked));
});
