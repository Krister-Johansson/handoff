import { expect, test } from "vitest";
import nextConfig from "../next.config";

test("every page is served origin-keyed, which WebMCP has needed in Chrome", async () => {
  const headers = await nextConfig.headers!();
  expect(headers).toContainEqual({ source: "/:path*", headers: [{ key: "Origin-Agent-Cluster", value: "?1" }] });
});
