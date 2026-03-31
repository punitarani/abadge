// Agent credential access: authenticate with an API key and retrieve a secret.
// The agent must already have a permission grant for the target credential.

import { AbadgeClient, ApprovalRequiredError } from "@abadge/sdk";

// Agent authenticates with its API key (the abd_... key shown once at registration)
const client = new AbadgeClient({
  apiUrl: "http://localhost:8787",
  token: "abd_...", // agent API key
});

try {
  // Access a credential by name
  const result = await client.accessCredential({
    credentialName: "prod-db-url",
    deliveryMode: "env_inject",
    purpose: "Database migration",
  });

  if (result.value) {
    // Inject into subprocess environment -- never log the raw value
    console.log("Got credential for:", result.credential.name);
    console.log("Delivery mode:", result.deliveryMode);
  }
} catch (err) {
  if (err instanceof ApprovalRequiredError) {
    // A policy requires human approval before this credential can be accessed.
    // The request is queued; retry after approval.
    console.log("Access pending approval");
  } else {
    throw err;
  }
}
