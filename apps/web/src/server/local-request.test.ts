import { expect, test } from "vitest";
import { isLocalHost, isSameLocalOrigin } from "./local-request";

test("only this machine's host names count as local", () => {
  expect(isLocalHost("localhost:3000")).toBe(true);
  expect(isLocalHost("127.0.0.1:3000")).toBe(true);
  expect(isLocalHost("[::1]:3000")).toBe(true);
  expect(isLocalHost("evil.example.com")).toBe(false);
  expect(isLocalHost("localhost.evil.example.com:3000")).toBe(false);
  expect(isLocalHost(null)).toBe(false);
});

test("a request passes with no Origin or the dashboard's own, on a local host", () => {
  expect(isSameLocalOrigin(null, "localhost:3000")).toBe(true);
  expect(isSameLocalOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
  expect(isSameLocalOrigin("https://evil.example.com", "localhost:3000")).toBe(false);
  expect(isSameLocalOrigin("http://localhost:3000", "rebound.example.com")).toBe(false);
});
