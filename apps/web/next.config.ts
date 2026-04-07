import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@abadge/core", "@abadge/auth"],
  env: {
    ABADGE_API_URL: process.env.ABADGE_API_URL,
    ABADGE_APP_URL: process.env.ABADGE_APP_URL,
  },
  async redirects() {
    return [
      {
        source: "/install",
        destination: "https://raw.githubusercontent.com/punitarani/abadge/main/install.sh",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
