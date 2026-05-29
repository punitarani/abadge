import { AbadgeAgentClient } from "@abadge/sdk";

/**
 * Example: an AI agent reading a secret with its keypair session.
 *
 * The agent authenticates via Ed25519 keypair session exchange — it provides its
 * agent ID and private key, calls `connect()` to exchange a short-lived `abs_`
 * session token, then reads a specific item by ID. Reading requires an explicit
 * `read` permission on the (agent, item) pair.
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
    // Canonical read: server-managed items return a decrypted `payload`; ZK
    // items return `ciphertext` for the local daemon to decrypt.
    const result = await client.access.read("item-id");
    if (result.payload) {
      console.log("Label:", result.payload.label);
      console.log("Fields:", result.payload.fields);
    }
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
});
