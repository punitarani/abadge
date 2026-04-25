import type { NextConfig } from "next";

// Routes whose URLs may contain sensitive tokens (e.g. `?token=abi_...` on
// /invite/accept and /join, forwarded via ?redirect= through /login and
// /register). We set Referrer-Policy: no-referrer on these pages so outbound
// resource loads (fonts, avatars, analytics, external links) cannot leak the
// token via the Referer header to third-party hosts.
const NO_REFERRER_ROUTES = ["/invite/:path*", "/join", "/login", "/register"] as const;

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
  async headers() {
    return NO_REFERRER_ROUTES.map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }));
  },
};

export default nextConfig;
