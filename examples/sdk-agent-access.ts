import { AbadgeAgentClient } from "@abadge/sdk";

/**
 * Example: an AI agent revealing a secret value with its keypair session.
 *
 * The agent authenticates via Ed25519 keypair session exchange — it provides its
 * agent ID and private key, calls `connect()` to exchange a short-lived `abs_`
 * session token, then requests a specific secret by ID. Reading a value requires
 * an explicit `reveal`/`read` permission on the (agent, item) pair.
 */
async function main(): Promise<void> {
  const client = new AbadgeAgentClient({
    apiUrl: "https://api.abadge.com",
    agentId: process.env.ABADGE_AGENT_ID ?? "agent-id",
    // A CryptoKey, an Ed25519 JWK object, or a JWK string (as shown here).
    privateKey: process.env.ABADGE_PRIVATE_KEY ?? "{...}",
  });

  await client.connect();
  try {
    const secret = await client.accessReveal({ itemId: "item-id" });
    console.log(`Revealed ${secret.field}: ${secret.value}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
});
