/**
 * Local dev/test seeder.
 *
 * Drives the *real* public API exactly like apps/e2e/.../golden-path.test.ts —
 * signup → sign-in → create org/profile/item/agents/permissions via the SDK —
 * so a fresh local stack goes from empty to "clickable in the UI, callable from
 * the CLI/MCP/API" in one command. The only non-HTTP step is flipping
 * `user.email_verified` directly in Postgres, because local dev has no SMTP and
 * Better Auth blocks sign-in until the address is verified.
 *
 * Assumes the stack is already running (`bun run dev`) and a reachable Postgres.
 * It does NOT generate env files and does NOT depend on Doppler.
 *
 *   bun run seed                       # default demo tenant
 *   bun run seed -- --email me@x.dev   # custom login
 *
 * Re-running converges on a single demo set (same org, profile, item, and
 * agent IDs each time): everything is reused rather than recreated, since
 * agents revoke instead of hard-deleting and items soft-delete. The CLI agent's
 * one-time API key is rotated on each run so a working key is always printed;
 * the MCP agent's keypair file is left in place (keypair rotation is
 * unsupported, and the on-disk private key stays valid).
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createDb, eq } from "@abadge/db";
import { user as userTable } from "@abadge/db/schema";
import { AbadgeUserClient } from "@abadge/sdk";

const DEFAULTS = {
  apiUrl: process.env.ABADGE_API_URL ?? "http://localhost:8787",
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://abadge:abadge@localhost:5432/abadge",
  email: "dev@abadge.local",
  password: "DevPassword123!",
  name: "Dev User",
};

const ITEM_LABEL = "seed-demo-secret";
const CLI_AGENT_NAME = "seed-cli-agent";
const MCP_AGENT_NAME = "seed-mcp-agent";
const KEY_FILE = join(homedir(), ".abadge", `${MCP_AGENT_NAME}.key.json`);

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Create the demo user (idempotent), force email verification, sign in for a bearer token. */
async function signupAndLogin(
  apiUrl: string,
  databaseUrl: string,
  creds: { email: string; password: string; name: string },
): Promise<string> {
  const signup = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  // A 4xx here is almost always "user already exists" on a re-run — tolerated.
  // A real failure surfaces below when sign-in cannot get a token.
  const signupBody = signup.ok ? "" : await signup.text();

  const db = createDb(databaseUrl);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, creds.email));

  const signin = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  if (!signin.ok) {
    throw new Error(
      `sign-in failed (${signin.status}): ${await signin.text()}` +
        (signupBody ? `\n(sign-up also failed earlier: ${signupBody})` : ""),
    );
  }
  const token = signin.headers.get("set-auth-token");
  if (!token) throw new Error("sign-in did not return a set-auth-token header");
  return token;
}

/** Reuse the active demo item by label, else create a server-managed one. */
async function ensureItem(client: AbadgeUserClient): Promise<string> {
  const existing = (await client.items.list()).items.find((i) => i.label === ITEM_LABEL);
  if (existing) return existing.id;
  const created = await client.items.create({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: ITEM_LABEL,
      kind: "api_key",
      tags: ["seed", "demo"],
      fields: { value: "seed-demo-secret-value-do-not-use-in-prod" },
    },
  });
  return created.id;
}

/** Legacy API-key agent: reuse + rotate for a fresh one-time key, else create. */
async function ensureCliAgent(
  client: AbadgeUserClient,
  live: ReadonlyArray<{ id: string; name: string }>,
): Promise<{ id: string; apiKey: string | null }> {
  const existing = live.find((a) => a.name === CLI_AGENT_NAME);
  if (existing) {
    return { id: existing.id, apiKey: (await client.agents.update(existing.id)).apiKey };
  }
  const created = await client.agents.create({
    name: CLI_AGENT_NAME,
    kind: "local_cli",
    authMethod: "legacy_api_key",
  });
  return { id: created.agent.id, apiKey: created.apiKey };
}

/**
 * Keypair MCP agent. Reusing keeps the existing on-disk key valid (keypair
 * rotation is unsupported). Create — and write a fresh 0600 key file — only
 * when no live agent exists, or when a prior run's key file is missing (the
 * orphaned agent is revoked first so it can be replaced).
 */
async function ensureMcpAgent(
  client: AbadgeUserClient,
  live: ReadonlyArray<{ id: string; name: string }>,
): Promise<string> {
  let existing = live.find((a) => a.name === MCP_AGENT_NAME);
  if (existing && !existsSync(KEY_FILE)) {
    await client.agents.delete(existing.id);
    existing = undefined;
  }
  if (existing) return existing.id;

  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);
  const agent = await client.agents.create({
    name: MCP_AGENT_NAME,
    kind: "local_mcp",
    authMethod: "public_key_session",
    publicKey: JSON.stringify(publicJwk),
  });
  mkdirSync(join(homedir(), ".abadge"), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify(privateJwk, null, 2));
  chmodSync(KEY_FILE, 0o600);
  return agent.agent.id;
}

/** Grant reveal_plaintext where missing (permissions.create rejects duplicates). */
async function ensureGrant(
  client: AbadgeUserClient,
  agentId: string,
  itemId: string,
): Promise<void> {
  const existing = await client.permissions.list({ agentId, itemId });
  if (!existing.permissions.some((p) => p.capability === "reveal_plaintext")) {
    await client.permissions.create({ agentId, itemId, capabilities: ["reveal_plaintext"] });
  }
}

async function main(): Promise<void> {
  const apiUrl = getArg("--api-url") ?? DEFAULTS.apiUrl;
  const databaseUrl = getArg("--database-url") ?? DEFAULTS.databaseUrl;
  const email = getArg("--email") ?? DEFAULTS.email;
  const password = getArg("--password") ?? DEFAULTS.password;
  const name = getArg("--name") ?? DEFAULTS.name;

  // Fail fast with a clear message if the stack isn't up.
  const health = await fetch(`${apiUrl}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `API not reachable at ${apiUrl}/health. Start the stack first (bun run dev), ` +
        `or pass --api-url.`,
    );
  }

  console.log(`→ Signing up + verifying ${email} …`);
  const sessionToken = await signupAndLogin(apiUrl, databaseUrl, { email, password, name });

  // Prefer the personal account; fall back to any org, else create one.
  // createPersonal auto-seeds a default profile so the org is immediately usable.
  const bootstrap = new AbadgeUserClient({ apiUrl, sessionToken });
  const { organizations } = await bootstrap.orgs.list();
  const org =
    organizations.find((o) => o.isPersonal) ??
    organizations[0] ??
    (await bootstrap.orgs.createPersonal());
  console.log(`→ Org: ${org.name} (${org.id})${org.isPersonal ? " [personal]" : ""}`);

  const client = new AbadgeUserClient({ apiUrl, sessionToken, orgId: org.id });

  const { profiles } = await client.profiles.list(org.id);
  const profile =
    profiles.find((p) => p.storageMode === "server_managed") ??
    (await client.profiles.create({
      orgId: org.id,
      name: "default",
      storageMode: "server_managed",
    }));
  console.log(`→ Profile: ${profile.name} (${profile.id})`);

  // Reuse-or-create throughout: agents revoke (never hard-delete) and items
  // soft-delete, so recreating every run would pile up clutter. Converge on a
  // single live demo set instead.
  const itemId = await ensureItem(client);
  console.log(`→ Item: ${ITEM_LABEL} (${itemId})`);

  const live = (await client.agents.list()).agents.filter((a) => a.enabled && !a.revokedAt);
  const cli = await ensureCliAgent(client, live);
  const mcpAgentId = await ensureMcpAgent(client, live);
  await ensureGrant(client, cli.id, itemId);
  await ensureGrant(client, mcpAgentId, itemId);
  console.log(`→ Agents + permissions ready`);

  console.log(`
╭─ abadge seeded ────────────────────────────────────────────
│ Web login   ${email} / ${password}
│              ${apiUrl.replace(":8787", ":3000")}/login
│
│ Org          ${org.id}
│ Profile      ${profile.id}
│ Item         ${itemId}  (${ITEM_LABEL})
│
│ Operator bearer token (CLI --token-stdin, X-Abadge-Org-Id header):
│   ${sessionToken}
│
│ CLI agent    ${cli.id}
│   API key:   ${cli.apiKey ?? "(not returned)"}
│
│ MCP agent    ${mcpAgentId}  (keypair)
│   Private key: ${KEY_FILE}
│   Run MCP:   ABADGE_API_URL=${apiUrl} \\
│              ABADGE_AGENT_ID=${mcpAgentId} \\
│              ABADGE_PRIVATE_KEY_PATH=${KEY_FILE} \\
│              bun packages/mcp/src/index.ts
╰────────────────────────────────────────────────────────────`);
}

main()
  // createDb opens a postgres-js pool that keeps the event loop alive; exit
  // explicitly once the (already-awaited) work is done so this one-shot script
  // terminates instead of hanging on the open connection.
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
