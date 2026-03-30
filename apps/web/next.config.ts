import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@abadge/core", "@abadge/auth"],
};

export default nextConfig;
