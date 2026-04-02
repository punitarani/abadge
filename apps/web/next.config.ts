import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@abadge/core", "@abadge/auth"],
  env: {
    ABADGE_API_URL: process.env.ABADGE_API_URL,
    ABADGE_APP_URL: process.env.ABADGE_APP_URL,
  },
};

export default nextConfig;
