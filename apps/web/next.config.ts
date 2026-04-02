import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@abadge/core", "@abadge/auth"],
  // Keep ABADGE_* as the canonical input names and derive the browser-safe
  // NEXT_PUBLIC_* values at build time so OpenNext does not require runtime secrets.
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ??
      process.env.ABADGE_API_URL ??
      "http://localhost:8787",
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.ABADGE_APP_URL ??
      "http://localhost:3000",
  },
};

export default nextConfig;
