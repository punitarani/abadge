// Agent access: authenticate with an API key and request a server-managed item.
// The agent must already have a permission for the target item.

import { AbadgeAgentClient } from "@abadge/sdk";

const client = new AbadgeAgentClient({
  apiUrl: "http://localhost:8787",
  apiKey: "abg_...", // agent API key shown once at registration
});

const result = await client.accessReveal("item_123");

console.log("Payload label:", result.payload.label);
console.log("Payload fields:", result.payload.fields);
