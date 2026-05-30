/**
 * abadge SDK example 01 — Store a secret and grant an agent access to it.
 *
 * This is the MANAGEMENT side of the abadge trust model. A human operator (or a
 * backend service acting on their behalf) provisions a credential for an AI
 * agent. It deliberately NEVER reads the secret value.
 *
 * Trust tiers (why this matters):
 *   - AbadgeUserClient  -> authenticated with a Better Auth session token OR an
 *     `abu_` personal API key. This is the MANAGEMENT surface. It can create
 *     items, register agents, grant permissions, and read the audit log. It
 *     CANNOT call the agent access surface (`access.read` / `access.use`) — those
 *     throw UNAUTHORIZED for a session/`abu_` bearer. A personal API key never
 *     becomes an agent.
 *   - AbadgeAgentClient -> authenticated with an Ed25519 keypair that exchanges
 *     for a short-lived `abs_` agent session. ONLY a keypair agent that holds an
 *     explicit (agent, item, capability) permission can read a secret value.
 *
 * So the operator here does the SETUP, and a separate agent process (see
 * example 02) does the READ. The operator literally cannot exfiltrate the value
 * through this client — that's the firewall.
 */

import { AbadgeApiError, AbadgeUserClient } from "@abadge/sdk";

async function main(): Promise<void> {
  // --- Credentials come from the environment; never hardcode real secrets. ---
  const apiUrl = process.env.ABADGE_API_URL;
  // A Better Auth session token OR an `abu_` personal API key. Both resolve to
  // the same management-only identity.
  const sessionToken = process.env.ABADGE_SESSION_TOKEN;
  // Required only if your user belongs to more than one organization. If you
  // have exactly one org you can omit it and the server resolves it for you.
  const orgId = process.env.ABADGE_ORG_ID;

  if (!apiUrl || !sessionToken) {
    throw new Error(
      "Set ABADGE_API_URL and ABADGE_SESSION_TOKEN (an `abu_` key or a Better Auth session token).",
    );
  }

  const client = new AbadgeUserClient({
    apiUrl,
    sessionToken,
    orgId, // undefined is fine for single-org users
  });

  try {
    // ------------------------------------------------------------------
    // 1. Store a secret as a server_managed item.
    //    server_managed = abadge encrypts it for you with AES-256-GCM. The
    //    plaintext is sent over TLS once, encrypted at rest, and only ever
    //    decrypted again for an authorized agent read. (The zero_knowledge
    //    mode, where the client encrypts before upload, is the advanced path.)
    //
    //    `fields` is a string map; `value` is the conventional single-field key
    //    for an api_key item. `kind` is one of the ITEM_KINDS constants.
    // ------------------------------------------------------------------
    const { id: itemId } = await client.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "OpenAI API key (prod)",
        kind: "api_key",
        fields: {
          // In real usage, read this from a secure source, e.g. process.env.
          value: process.env.SECRET_TO_STORE ?? "sk-example-do-not-use",
        },
      },
    });
    console.log(`Stored item: ${itemId}`);

    // ------------------------------------------------------------------
    // 2. Register a remote agent and issue a one-time bootstrap token.
    //    `issueBootstrapToken: true` enrolls the agent later: the agent process
    //    will generate its OWN Ed25519 keypair and redeem this token to bind its
    //    public key (see example 02). The operator never holds the agent's
    //    private key — that's what keeps the access surface separate.
    // ------------------------------------------------------------------
    const created = await client.agents.create({
      name: "ci-deploy-bot",
      kind: "remote",
      issueBootstrapToken: true,
    });
    const agentId = created.agent.id;
    console.log(`Registered agent: ${agentId} (${created.agent.name})`);

    // The bootstrap token is shown EXACTLY ONCE and is not recoverable. Hand it
    // to the agent operator over a secure channel; it expires in ~10 minutes.
    if (created.bootstrapToken) {
      console.log("");
      console.log("=== SAVE THIS NOW — shown only once, expires in ~10 minutes ===");
      console.log(`  Bootstrap token: ${created.bootstrapToken}`);
      if (created.bootstrapExpiresAt) {
        console.log(`  Expires at:      ${created.bootstrapExpiresAt}`);
      }
      console.log("===============================================================");
      console.log("");
    }

    // ------------------------------------------------------------------
    // 3. Grant the agent read access on this item.
    //    Item-target grants use the legacy capability names: `reveal_plaintext`
    //    and `read_ciphertext` map to canonical `read` (the agent receives the
    //    secret VALUE), while `mount_env`/`mount_file` map to canonical `use`
    //    (the agent only mounts the secret into a subprocess, never receiving
    //    the value). Canonical `read`/`use` apply to profile-target grants
    //    (pass `profileId` instead of `itemId`). We grant `reveal_plaintext`
    //    here so the deploy bot can read the API key directly.
    //
    //    Note the field is `capabilities` (a non-empty array), not `capability`.
    //    Grants are atomic per batch: all rows commit or none do.
    // ------------------------------------------------------------------
    const { permissions } = await client.permissions.create({
      agentId,
      itemId,
      capabilities: ["reveal_plaintext"],
    });
    console.log(`Granted ${permissions.length} permission(s) on item ${itemId} to agent ${agentId}`);

    // ------------------------------------------------------------------
    // 4. Read the recent audit trail.
    //    Every access attempt — allowed or denied — is logged immutably. Right
    //    now you'll mostly see the management events above (item create, agent
    //    register, permission grant). Once the agent reads the secret, those
    //    access events show up here too.
    // ------------------------------------------------------------------
    const { entries } = await client.audit.list({ limit: 5 });
    console.log("");
    console.log(`Recent audit entries (${entries.length}):`);
    for (const entry of entries) {
      console.log(
        `  ${entry.occurredAt}  ${entry.eventType}  result=${entry.result}` +
          `${entry.itemId ? `  item=${entry.itemId}` : ""}` +
          `${entry.agentId ? `  agent=${entry.agentId}` : ""}`,
      );
    }

    console.log("");
    console.log("Done. The operator provisioned the credential but never read its value.");
    console.log("Only the keypair agent (example 02) can do that.");
  } catch (err) {
    // Typed errors carry a machine code and a human hint. Surface both.
    if (err instanceof AbadgeApiError) {
      console.error(`abadge error [${err.code}]: ${err.message}`);
      if (err.hint) console.error(`  hint: ${err.hint}`);
      // If you ever try to call access.read/access.use with this client, expect
      // an UNAUTHORIZED error here — by design. The management surface cannot
      // read secret values.
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

void main();
