import { withContentCollections } from "@content-collections/next";
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
  experimental: {
    // Rewrites `import { Foo } from "lucide-react"` (a barrel) to a deep,
    // tree-shakeable import. lucide-react and @phosphor-icons/react are in
    // Next 15's documented auto-optimize list. radix-ui (umbrella) is added
    // optimistically: if the umbrella isn't supported, this entry is a no-op
    // and the regular `radix-ui` barrel still tree-shakes via standard ESM
    // (verify with `bun run build` and inspect bundle size).
    optimizePackageImports: ["lucide-react", "@phosphor-icons/react", "radix-ui"],
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

// withContentCollections must be the outermost plugin. It runs the
// content build at config-load time, so generated data in
// `.content-collections/generated` is ready before bundling (works under
// both `next build` and `next dev --turbopack`).
export default withContentCollections(nextConfig);
