import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@handoff/core", "@handoff/db", "@handoff/github", "@handoff/engine", "@handoff/cli-adapter"],
  // Chrome's WebMCP docs ask for origin-isolated documents; the spec dropped that on 2026-09-30, so this
  // stays until Chrome is checked without it.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Origin-Agent-Cluster", value: "?1" }] }];
  },
};

export default nextConfig;
