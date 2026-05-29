/**
 * abadge SDK example 02 — Agent reads a granted secret and uses it.
 *
 * Scenario: an autonomous agent (e.g. a deployment bot) authenticates with its
 * own Ed25519 keypair, reads a secret it has been explicitly granted, and uses
 * that secret to make an authenticated outbound API call.
 *
 * WHY an AGENT client (not a user client):
 *   abadge has two trust tiers. The MANAGEMENT surface (AbadgeUserClient /
 *   Better Auth session / `abu_` personal API key) can create items, agents,
 *   and permissions — but it can NEVER call `access.*`. Only the ACCESS surface
 *   (AbadgeAgentClient, backed by an Ed25519 keypair → `abs_` session token)
 *   can read or use a secret VALUE, and only when an explicit
 *   (agent, item, capability) permission exists. So a bot that must READ a
 *   secret authenticates as an AGENT, never with a personal API key.
 *
 * Run:  bun run agent-read.ts        (or:  npx tsx agent-read.ts)
 */

import { AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";

// --- Configuration from the environment (never hardcode credentials) --------
// ABADGE_API_URL    — base API URL, e.g. https://api.abadge.dev
// ABADGE_AGENT_ID   — this agent's id (from `abadge agent add` / agents.create)
// ABADGE_PRIVATE_KEY — the agent's Ed25519 private key as a JWK *string*
//                      ({"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}).
//                      The matching publicKey was registered when the agent was
//                      created; the private key never leaves the agent.
// ABADGE_ITEM_ID    — the item this agent has been granted `read` on.
const apiUrl = requireEnv("ABADGE_API_URL");
const agentId = requireEnv("ABADGE_AGENT_ID");
const privateKey = requireEnv("ABADGE_PRIVATE_KEY");
const itemId = requireEnv("ABADGE_ITEM_ID");

// A placeholder downstream API the bot wants to call with the secret.
const downstreamUrl = process.env.DOWNSTREAM_API_URL ?? "https://httpbin.org/bearer";

async function main(): Promise<void> {
  const agent = new AbadgeAgentClient({ apiUrl, agentId, privateKey });

  try {
    // connect() performs the Ed25519 challenge/response exchange and obtains a
    // short-lived `abs_` session token (15-minute default TTL). It also starts
    // a background refresh loop that re-exchanges the keypair at T-2 minutes,
    // so a long-running bot keeps a valid session without ever persisting a
    // long-lived bearer on disk. MUST be called before any access.* method.
    await agent.connect();

    // Read the secret. The server checks the (agent, item, `read`) permission,
    // logs the attempt to the immutable audit log (allowed OR denied), and
    // returns a discriminated union keyed on `storageMode`.
    const result = await agent.access.read(itemId, {
      // `purpose` is recorded in the audit entry — useful for traceability.
      purpose: "deploy-bot: authenticate outbound API call",
    });

    if (result.storageMode === "server_managed") {
      // server_managed: the server holds the AES-256-GCM key and decrypts on an
      // authorized read, returning the plaintext payload. This is the path a
      // REMOTE agent uses — no local key material is required.
      //
      // `payload.fields` is a Record<string,string>; single-value items (token,
      // api_key, …) put the value under the conventional "value" field.
      const token = result.payload.fields.value;
      if (!token) {
        throw new Error(
          `Item ${itemId} has no "value" field; fields: ${Object.keys(result.payload.fields).join(", ")}`,
        );
      }

      // Use the secret: set it as a bearer on an outbound request. The value
      // lives only in this process's memory for the duration of the call.
      const res = await fetch(downstreamUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // NOTE: we print the downstream STATUS, never the secret itself.
      console.log(`Downstream ${downstreamUrl} -> HTTP ${res.status}`);
    } else {
      // zero_knowledge: the server NEVER sees the plaintext. It returns an
      // encrypted envelope (encryptedItemKey + ciphertext) that can only be
      // decrypted with the profile root key, which is derived client-side from
      // a password and held in memory by the local vault daemon (vaultd).
      //
      // A REMOTE agent has no daemon and no password, so it cannot decrypt this
      // envelope — by design. Zero-knowledge items are for LOCAL agents
      // (CLI/MCP) running alongside an unlocked daemon. Remote/autonomous
      // agents like this deploy bot should be granted server_managed items.
      console.error(
        `Item ${itemId} is zero_knowledge: returned an encrypted envelope ` +
          `(wrapped key=${result.encryptedItemKey.length}B, cryptoVersion=${result.cryptoVersion}). ` +
          "Remote agents cannot decrypt ZK items — use a server_managed item instead.",
      );
      process.exitCode = 1;
    }
  } catch (err) {
    // Typed errors carry a machine code + a human hint. PERMISSION_DENIED here
    // means the agent has no (agent, item, `read`) grant — fix it on the
    // management surface (permissions.create), not in this code.
    if (err instanceof AbadgeApiError) {
      console.error(`[${err.code}] ${err.message}${err.hint ? ` — ${err.hint}` : ""}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    // ALWAYS disconnect. connect() started a background refresh timer; without
    // disconnect() that timer keeps the Node/Bun process alive (and keeps
    // re-exchanging the session) past the work it was meant to do. disconnect()
    // stops the timer and lets the process exit cleanly.
    agent.disconnect();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

void main();
