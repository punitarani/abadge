import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// The web app is currently a prerendered shell with client-side API calls:
// no route handlers, middleware, server actions, ISR, or on-demand revalidation.
// Use the static-assets cache path recommended for SSG apps and keep all
// revalidation infrastructure explicitly disabled.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
  routePreloadingBehavior: "none",
  tagCache: "dummy",
  queue: "dummy",
  cachePurge: "dummy",
});
