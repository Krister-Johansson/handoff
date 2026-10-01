import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@handoff/core", "@handoff/db", "@handoff/github", "@handoff/engine", "@handoff/cli-adapter"],
};

export default nextConfig;
