import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@handoff/core", "@handoff/db", "@handoff/github"],
};

export default nextConfig;
