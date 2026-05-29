/**
 * abadge SDK example 03 — Zero-pre-shared-secret agent enrollment (CI / remote worker first run)
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A CI job or a remote worker needs to read a secret from abadge. The naive
 * approach is to ship a long-lived API key in the job's environment. That key
 * is a bearer credential: anyone who reads the CI logs, the build cache, or a
 * leaked env dump now holds a permanent, replayable secret. There is no way to
 * tell a stolen key from a legitimate one, and rotation means touching every
 * consumer.
 *
 * abadge agents do the opposite. The agent authenticates with an Ed25519
 * KEYPAIR. The PRIVATE KEY never leaves the agent; only the PUBLIC key is ever
 * uploaded. Sessions are short-lived `abs_` tokens minted by signing a
 * server-issued challenge — a stolen session token expires in 15 minutes, and a
 * stolen log line is worthless because it never contained the private key.
 *
 * BOOTSTRAP-THEN-KEYPAIR vs SHIPPING A LONG-LIVED KEY
 * ---------------------------------------------------
 * The operator (a human, using AbadgeUserClient — see example 01) registers the
 * agent with `issueBootstrapToken: true`. That mints a ONE-TIME bootstrap token
 * (prefix `abe_`, 10-minute TTL). The bootstrap token is NOT a secret you keep:
 * it is a single-use coupon that lets the agent bind ITS OWN freshly-generated
 * public key, once. After enrollment it is dead. So even if the bootstrap token
 * leaks, the window is 10 minutes and a single use; after that the only
 * credential that matters is the private key, which was generated locally and
 * never transmitted.
 *
 * Contrast: a long-lived API key is valid forever, is the actual secret, and
 * travels over the wire at issuance. The bootstrap flow moves the trust anchor
 * to a key the server never sees.
 *
 * TRUST TIER (why an AGENT client, not a user client)
 * ---------------------------------------------------
 * Reading a secret VALUE is the ACCESS surface. Only an AbadgeAgentClient
 * (keypair-backed `abs_` session) with an explicit (agent, item, capability)
 * permission can call `access.read`. A management credential (`abu_` / Better
 * Auth session via AbadgeUserClient) is deliberately barred from `access.*` and
 * would get UNAUTHORIZED. A CI job that must READ a secret therefore runs as an
 * AGENT.
 *
 * THE FLOW (this file)
 * --------------------
 *   1. generateEd25519KeyPair()  -> { publicKey, privateKey } (both JWK strings)
 *   2. client.enroll(bootstrapToken, publicKey)   ONE-TIME — first run only
 *   3. client.connect()          Ed25519 challenge/response -> abs_ session
 *   4. client.access.read(itemId)
 *   5. client.disconnect()       in finally
 *
 * ENROLL IS ONE-TIME. On subsequent runs (the steady state) you skip step 1-2
 * entirely: you already have the private key (stored as a CI secret) and the
 * agent is already enrolled, so you go straight to connect(). This file shows
 * the first-run path and prints the private key so you can stash it; real CI
 * would generate the key in a setup step and save it to the secret store.
 */

import { generateEd25519KeyPair } from "@abadge/crypto";
import { AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";

// --- Configuration from the environment (never hardcode credentials) --------
const apiUrl = requireEnv("ABADGE_API_URL"); // e.g. https://api.abadge.dev
const agentId = requireEnv("ABADGE_AGENT_ID"); // the agent the operator registered
const bootstrapToken = requireEnv("ABADGE_BOOTSTRAP_TOKEN"); // one-time abe_ token
const itemId = requireEnv("ABADGE_ITEM_ID"); // an item the agent was granted

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  // 1. Generate the keypair LOCALLY. The private key is created on this machine
  //    and never transmitted. Only `publicKey` is uploaded during enroll().
  const { publicKey, privateKey } = await generateEd25519KeyPair();

  // STORAGE GUIDANCE (read this — it is the whole point of the pattern):
  //   Persist `privateKey` in a secret store (GitHub Actions secret, Vault,
  //   the runner's encrypted env) and reuse it on every subsequent run. On
  //   later runs you DO NOT call enroll() again — you construct the client with
  //   the stored privateKey and call connect() directly. Treat the private key
  //   like any root credential: it is the only durable secret in this flow.
  //
  //   We print it here only so this first-run demo can hand it to you. In a
  //   real setup step you would write it straight to the secret store and never
  //   echo it to a log.
  console.log("Generated Ed25519 keypair. Store the PRIVATE KEY as a CI secret:");
  console.log(`  ABADGE_PRIVATE_KEY=${privateKey}`);
  console.log("(The public key is uploaded during enroll; it is not sensitive.)\n");

  // Construct the agent client with the private key. No session yet — connect()
  // and enroll() do the network work.
  const client = new AbadgeAgentClient({ apiUrl, agentId, privateKey });

  try {
    // 2. ENROLL — ONE-TIME, FIRST RUN ONLY. Redeems the one-time bootstrap
    //    token and binds THIS agent's public key to the server-side record.
    //    Must happen BEFORE connect(): connect() signs a challenge against the
    //    public key the server has on file, so the key has to be enrolled first.
    //    On steady-state runs, delete this block — the agent is already enrolled
    //    and re-redeeming a spent bootstrap token would fail.
    const enrollment = await client.enroll(bootstrapToken, publicKey);
    console.log(`Enrolled agent ${enrollment.agent.id} at ${enrollment.enrolledAt}.`);

    // 3. CONNECT — Ed25519 challenge/response. The server issues a challenge,
    //    the SDK signs it with the private key, the server verifies against the
    //    enrolled public key and returns a short-lived `abs_` session token.
    //    The SDK also starts a background T-2min auto-refresh.
    await client.connect();
    console.log("Connected. Holding a short-lived abs_ session.\n");

    // 4. READ the granted item. This is the ACCESS surface — it works only
    //    because (a) we are a keypair agent and (b) the operator granted this
    //    agent the `read` capability on this item. `purpose` is recorded in the
    //    immutable audit log alongside the access.
    const result = await client.access.read(itemId, { purpose: "ci-first-run" });

    if (result.storageMode === "server_managed") {
      // server-managed items are decrypted by the server and returned as a
      // payload. `fields` holds the secret values — handle with care.
      console.log(`Read server-managed item "${result.payload.label ?? itemId}".`);
      console.log(`Fields available: ${Object.keys(result.payload.fields).join(", ")}`);
    } else {
      // zero-knowledge items come back as an encrypted envelope; the server
      // never holds the key. Decryption happens locally via the vault daemon.
      console.log(`Read zero-knowledge item ${result.itemId} (encrypted envelope).`);
      console.log("Decrypt locally via the vault daemon — the server never sees plaintext.");
    }
  } catch (err) {
    if (err instanceof AbadgeApiError) {
      // Typed errors carry an actionable hint. Common cases here:
      //   BOOTSTRAP_TOKEN_INVALID / BOOTSTRAP_TOKEN_EXPIRED — token spent or >10min old
      //   PERMISSION_DENIED — the agent has no grant on this item
      console.error(`abadge error [${err.code}]: ${err.message}`);
      if (err.hint) console.error(`hint: ${err.hint}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    // 5. ALWAYS disconnect: stops the background refresh loop so the process
    //    can exit cleanly. Short-lived CI jobs especially need this.
    client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
