// SDK basics: item CRUD, agent registration, and permission creation.
// Requires a running abadge API and a valid session token.

import { AbadgeClient } from "@abadge/sdk";

const client = new AbadgeClient({
  apiUrl: "http://localhost:8787",
  token: "your-session-token",
});

const createdItem = await client.createItem({
  storageMode: "server_managed",
  payload: {
    v: 1,
    label: "prod-db-url",
    kind: "opaque",
    tags: ["prod"],
    fields: {
      value: "postgres://...",
    },
  },
});
console.log("Created item:", createdItem.id);

const { items } = await client.listItems();
console.log("Items:", items.map((item) => item.id));

const { agent, apiKey } = await client.createAgent({
  name: "deploy-bot",
  kind: "remote_agent",
});
console.log("Agent API key (save this now):", apiKey);

const { permission } = await client.createPermission({
  agentId: agent.id,
  itemId: createdItem.id,
  capability: "reveal_plaintext",
});
console.log("Created permission:", permission.id);

const { entries } = await client.getAudit({ limit: 5, agentId: agent.id });
console.log("Recent audit entries:", entries.length);
