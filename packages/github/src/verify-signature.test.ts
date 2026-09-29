import { expect, test } from "vitest";
import { signPayload } from "./testing/sign.ts";
import { verifyGitHubSignature } from "./verify-signature.ts";

const secret = "s3cret";
const body = JSON.stringify({ action: "completed", n: 1 });

test("verifyGitHubSignature accepts a body signed with the secret", () => {
  expect(verifyGitHubSignature(body, signPayload(secret, body), secret)).toBe(true);
});

test("verifyGitHubSignature rejects a tampered body", () => {
  expect(verifyGitHubSignature(body.replace("1", "2"), signPayload(secret, body), secret)).toBe(false);
});

test("verifyGitHubSignature rejects a missing or malformed header without throwing", () => {
  expect(verifyGitHubSignature(body, null, secret)).toBe(false);
  expect(verifyGitHubSignature(body, "sha1=abc", secret)).toBe(false);
  expect(verifyGitHubSignature(body, "sha256=zz", secret)).toBe(false);
  expect(verifyGitHubSignature(body, signPayload(secret, body), "")).toBe(false);
});
