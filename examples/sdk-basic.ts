// SDK basics: credential CRUD, agent registration, and permission grants.
// Requires a running abadge API and a valid session token.

import { AbadgeClient } from "@abadge/sdk";

const client = new AbadgeClient({
  apiUrl: "http://localhost:8787",
  token: "your-session-token",
});

// List credentials
const { credentials } = await client.listCredentials();
console.log(
  "Credentials:",
  credentials.map((c) => c.name),
);

// Create a credential
const { credential } = await client.createCredential({
  name: "prod-db-url",
  type: "api_key",
  value: "postgres://...",
  environment: "prod",
  sensitivity: "critical",
});
console.log("Created credential:", credential.id);

// Register an agent
const { agent, apiKey } = await client.createAgent({ name: "deploy-bot" });
console.log("Agent API key (save this!):", apiKey);

// Grant the agent access with restricted delivery mode
await client.grantPermission({
  agentId: agent.id,
  credentialId: credential.id,
  allowedDeliveryModes: ["env_inject"],
});
console.log("Permission granted");

// Verify via audit log
const { logs } = await client.getAuditLog({ limit: 5 });
console.log("Recent audit entries:", logs.length);
