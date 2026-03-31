import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Keep the dashboard on the minimal Worker-only path for MVP: no queue-backed
// revalidation, no tag cache Durable Objects, and no CDN purge workers.
export default defineCloudflareConfig({
  incrementalCache: "dummy",
  tagCache: "dummy",
  queue: "dummy",
  cachePurge: "dummy",
});
