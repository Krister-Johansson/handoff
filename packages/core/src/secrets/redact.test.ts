import { expect, test } from "vitest";
import { redactSecrets } from "./redact.ts";

test("redactSecrets removes authorization header values", () => {
  expect(redactSecrets("git -c http.extraheader=AUTHORIZATION: basic eC1hY2Nlc3M6dG9r== clone")).toBe("git -c http.extraheader=AUTHORIZATION: basic [redacted] clone");
  expect(redactSecrets("Authorization: Bearer abc.def-ghi")).toBe("Authorization: Bearer [redacted]");
});

test("redactSecrets removes GitHub and Anthropic tokens", () => {
  const gho = `gho_${"a".repeat(36)}`;
  const pat = `github_pat_${"B".repeat(40)}`;
  const oat = `sk-ant-oat01-${"c".repeat(40)}`;
  expect(redactSecrets(`token ${gho} and ${pat} and ${oat}`)).toBe("token [redacted] and [redacted] and [redacted]");
});

test("redactSecrets removes credentials embedded in URLs", () => {
  expect(redactSecrets("fatal: https://x-access-token:ghs_abc123@github.com/o/r.git")).toBe("fatal: https://[redacted]@github.com/o/r.git");
});

test("redactSecrets leaves ordinary text alone", () => {
  expect(redactSecrets("tests_green failed: exit 1")).toBe("tests_green failed: exit 1");
});
