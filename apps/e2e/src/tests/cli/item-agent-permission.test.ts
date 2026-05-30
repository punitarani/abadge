/**
 * Drives the real CLI binary through the item / agent / permission triad for a
 * server-managed item end-to-end, asserting that `permission create` accepts
 * repeated `--capability` flags and writes one row per capability.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { runCli } from "../../harness/cli";
import { mkTmpDir } from "../../harness/env";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();
const tmpHomes: string[] = [];

afterEach(() => {
  for (const h of tmpHomes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }
});

function freshHome(): string {
  const h = mkTmpDir("cli-home");
  tmpHomes.push(h);
  return h;
}

describe("cli item + agent + permission flow", () => {
  test("permission create accepts repeated --capability and yields the right rows", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = freshHome();
    const env = { home, apiUrl, sessionToken: owner.sessionToken };

    // SDK-backed setup: org + profile + item + agent. Faster than driving
    // each through the CLI; the CLI is what we actually want to assert on.
    const seedClient = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = await seedClient.orgs.create({
      name: "CLI Flow",
      slug: `cli-flow-${crypto.randomUUID()}`,
    });
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    // Org creation already seeded the default server_managed profile.
    const item = await scoped.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "cli-secret",
        kind: "opaque",
        tags: [],
        fields: { value: "sk-cli-test" },
      },
    });
    const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
    const agent = await scoped.agents.create({
      name: "cli-perm-agent",
      kind: "local_cli",
      authMethod: "public_key_session",
      publicKey: JSON.stringify(publicJwk),
    });

    const homeWithOrg = freshHome();
    const envWithOrg = { ...env, home: homeWithOrg, activeOrgId: org.id };

    // Repeated --capability via the binary
    const create = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env",
        "--capability",
        "mount_file",
      ],
      envWithOrg,
    );
    expect(create.exitCode).toBe(0);
    expect(create.stdout + create.stderr).toMatch(/Granted 2 permissions/);

    const list = await runCli(
      ["permission", "list", "--agent-id", agent.agent.id, "--json"],
      envWithOrg,
    );
    expect(list.exitCode).toBe(0);
    const rows = JSON.parse(list.stdout) as Array<{ capability: string }>;
    expect(rows.map((r) => r.capability).sort()).toEqual(["mount_env", "mount_file"]);

    // Re-grant — surfaces PERMISSION_ALREADY_EXISTS as a non-zero exit
    const dup = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env",
      ],
      envWithOrg,
    );
    expect(dup.exitCode).not.toBe(0);
    expect(dup.stdout + dup.stderr).toMatch(/PERMISSION_ALREADY_EXISTS|already exist/i);

    // Comma-separated form — schema rejects in-input duplicates client-side
    const dupInInput = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env,mount_env",
      ],
      envWithOrg,
    );
    expect(dupInInput.exitCode).not.toBe(0);
    expect(dupInInput.stdout + dupInInput.stderr).toMatch(/Duplicate/i);
  }, 90_000);
});
